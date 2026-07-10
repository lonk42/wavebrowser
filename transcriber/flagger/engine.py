"""Grammar-constrained batch scorer with digit-logit expectation.

Scores short transcriptions 0-9 in batches, ranking by a CONTINUOUS score: the
probability-weighted expectation over the digit tokens' logits at each score
position, not the bare generated integer. That breaks the model's coarse integer
ties (everything clustering at a few values) into a smooth ranking.

The model is asked for `{"scores": [[index, score], ...]}` — one [index, score]
pair per item. The echoed index is load-bearing: a bare digit array degenerates
(the model just counts 1,2,3,...); the index re-anchors attention per item.

`Engine.run` avoids create_chat_completion's logprobs path, which needs
logits_all=True (LM head computed for EVERY prompt token) plus a full-vocab
Python softmax per generated token. Here the model runs with logits_all=False and
we read only the 20 digit-token logits off the context after each sampled token —
identical scores, ~5x faster. This touches internal llama_cpp API
(`llama_get_logits`, `llm._ctx.ctx`) and is version-sensitive: pin the
llama-cpp-python version (see requirements.flagger.txt).
"""
import json
import math
import re

PAIR_RE = re.compile(r"\[\s*(\d+)\s*,\s*(\d)\s*\]")


def pairs_schema(n):
    # A bare digit array (no index echo) degenerates — the model just counts
    # 1,2,3,... instead of scoring. The echoed index anchors attention per item.
    return {
        "type": "object",
        "properties": {
            "scores": {
                "type": "array",
                "items": {
                    "type": "array",
                    "items": {"type": "integer", "minimum": 0, "maximum": 12},
                    "minItems": 2,
                    "maxItems": 2,
                },
                "minItems": n,
                "maxItems": n,
            }
        },
        "required": ["scores"],
    }


def build_user(batch):
    lines = [f"{i}. {t.replace(chr(10), ' ').strip()}" for i, t in enumerate(batch, 1)]
    body = "Rate these transmissions:\n\n" + "\n".join(lines)
    return (body + '\n\nReturn {"scores": [[1,s],[2,s],...]} — one [index, score] '
            f"pair per transmission, all {len(batch)} in order, score 0-9.")


def digit_expectation(digit_logits):
    """Expected value over the digit-token logits at one generated position.

    digit_logits: array of 20 raw logits, [logit("0")..logit("9"), logit(" 0")..].
    Softmax over just these and take the probability-weighted mean digit.
    """
    if digit_logits is None:
        return None
    mx = max(digit_logits)
    ps = [math.exp(x - mx) for x in digit_logits]
    den = sum(ps)
    num = sum((d % 10) * p for d, p in enumerate(ps))
    return num / den if den > 0 else None


def token_offsets(pieces):
    """[(start_char, digit_logits)] reconstructing char positions in content."""
    offs, pos = [], 0
    for piece, dl in pieces:
        offs.append((pos, dl))
        pos += len(piece)
    return offs, pos


def lp_at(offs, end, char_off):
    """digit logits of the token containing char_off."""
    for i, (start, dl) in enumerate(offs):
        stop = offs[i + 1][0] if i + 1 < len(offs) else end
        if start <= char_off < stop:
            return dl
    return None


def score_batch_entries(content, pieces, batch_len):
    """Parse one response -> {batch_idx0: continuous_score}.

    Falls back to the integer score for any item whose score digit couldn't be
    mapped back to a generated token position.
    """
    data = json.loads(content)
    offs, end = token_offsets(pieces) if pieces else ([], 0)
    pair_ms = {}
    for m in PAIR_RE.finditer(content):
        pair_ms.setdefault(int(m.group(1)), m)
    res = {}
    for pair in data.get("scores", []):
        try:
            idx, sc = int(pair[0]), int(pair[1])
        except (IndexError, TypeError, ValueError):
            continue
        if 1 <= idx <= batch_len:
            sc = max(0, min(9, sc))
            fsc = float(sc)
            m = pair_ms.get(idx)
            if m is not None and offs:
                e = digit_expectation(lp_at(offs, end, m.start(2)))
                if e is not None:
                    fsc = e
            res[idx - 1] = fsc
    return res


class Engine:
    """Grammar-constrained greedy decode with direct digit-logit capture."""

    def __init__(self, model_path, n_threads, n_ctx=2048):
        from llama_cpp import Llama
        self.llm = Llama(model_path=model_path, n_ctx=n_ctx, verbose=False,
                         n_threads=n_threads, n_threads_batch=n_threads)
        self.n_vocab = self.llm.n_vocab()
        # single-token ids for "0".."9" and " 0".." 9"
        self.digit_ids = []
        for s in [str(d) for d in range(10)] + [f" {d}" for d in range(10)]:
            t = self.llm.tokenize(s.encode(), add_bos=False, special=False)
            self.digit_ids.append(t[0] if len(t) == 1 else -1)
        self.eog = {self.llm.token_eos()}

    def close(self):
        try:
            self.llm.close()
        except Exception:  # noqa: BLE001 - best-effort; caller does del + gc
            pass

    def prompt(self, system, user):
        # ChatML (Qwen2.5/Qwen3). Qwen3's thinking block is precluded by the
        # grammar, which forces '{' as the first generated token.
        return (f"<|im_start|>system\n{system}<|im_end|>\n"
                f"<|im_start|>user\n{user}<|im_end|>\n"
                f"<|im_start|>assistant\n")

    def run(self, system, user, schema, max_tokens=1024):
        """-> (content, pieces) where pieces = [(text_piece, digit_logits)]."""
        import numpy as np
        from llama_cpp import llama_cpp as C
        from llama_cpp.llama_grammar import LlamaGrammar
        llm = self.llm
        toks = llm.tokenize(self.prompt(system, user).encode(), add_bos=False,
                            special=True)
        grammar = LlamaGrammar.from_json_schema(json.dumps(schema), verbose=False)
        pieces, content, depth, started = [], "", 0, False
        for tok in llm.generate(toks, temp=0.0, grammar=grammar):
            if tok in self.eog or len(pieces) >= max_tokens:
                break
            logits = np.ctypeslib.as_array(
                C.llama_get_logits(llm._ctx.ctx), shape=(self.n_vocab,))
            dl = [float(logits[i]) if i >= 0 else -1e30 for i in self.digit_ids]
            piece = llm.detokenize([tok]).decode("utf-8", errors="ignore")
            pieces.append((piece, dl))
            content += piece
            for ch in piece:
                if ch == "{":
                    depth += 1
                    started = True
                elif ch == "}":
                    depth -= 1
            if started and depth == 0:  # JSON object closed -> done
                break
        return content, pieces

    def score_batch(self, system, batch):
        """Score a batch of texts -> {batch_idx0: continuous_score}."""
        content, pieces = self.run(system, build_user(batch), pairs_schema(len(batch)))
        return score_batch_entries(content, pieces, len(batch))
