#!/usr/bin/env python3
"""inotify probe - does the recordings filesystem deliver watch events?

The transcriber treats inotify as a latency optimisation on top of a periodic
reconciliation sweep, precisely because inotify can be unreliable. This probe
lets you check, on a given filesystem, whether watchdog/inotify actually
delivers create events - and in particular whether it does so for files written
by a *different* host, which is the case that silently fails on NFS.

inotify is a local-VFS mechanism with no NFS-protocol awareness: a watcher only
sees changes made through its own kernel's mount. Two pods on the *same* node
sharing a local (or hostPath/local-path) volume share a kernel, so events flow.
Two pods on *different* nodes sharing an NFS RWX volume do not - the reader's
kernel is never told about the writer's changes, so its inotify watch stays
silent and only the sweep keeps things correct. Use this to confirm which case
you are in before relying on inotify for low latency.

Usage:
  # Self-contained check (watcher + writer in one process, one host):
  python inotify_probe.py selftest <dir>

  # Cross-host check - run these on the two pods/nodes sharing the volume:
  python inotify_probe.py watch <dir> --seconds 30      # on the reader host
  python inotify_probe.py write <dir> --count 5         # on the writer host

Exit status: selftest exits 0 if the event arrived, 1 if it did not.
Only watchdog is required (already present in the transcriber image).
"""

import os
import sys
import time
import argparse
import threading
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import PatternMatchingEventHandler


def _make_observer(directory, on_created):
    handler = PatternMatchingEventHandler(
        patterns=["*.mp3"], ignore_directories=True, case_sensitive=False
    )
    handler.on_created = on_created
    observer = Observer()
    observer.schedule(handler, str(directory), recursive=True)
    observer.start()
    return observer


def cmd_watch(args):
    directory = Path(args.dir)
    seen = []
    observer = _make_observer(
        directory, lambda e: (seen.append(e.src_path), print(f"EVENT  {e.src_path}", flush=True))
    )
    print(f"watching {directory} for {args.seconds}s (recursive)...", flush=True)
    try:
        time.sleep(args.seconds)
    finally:
        observer.stop()
        observer.join()
    print(f"done: {len(seen)} create event(s) delivered", flush=True)
    return 0 if seen else 1


def cmd_write(args):
    directory = Path(args.dir)
    directory.mkdir(parents=True, exist_ok=True)
    for i in range(args.count):
        p = directory / f"probe__{os.getpid()}_{i:03d}_000000000.mp3"
        p.write_bytes(b"\x00probe")
        print(f"wrote  {p}", flush=True)
        if i + 1 < args.count:
            time.sleep(args.interval)
    return 0


def cmd_selftest(args):
    directory = Path(args.dir)
    directory.mkdir(parents=True, exist_ok=True)
    got = threading.Event()
    observer = _make_observer(directory, lambda e: got.set())
    # Give the observer a moment to establish the watch before writing.
    time.sleep(1.0)
    target = directory / f"probe__{os.getpid()}_selftest_000000000.mp3"
    target.write_bytes(b"\x00probe")
    delivered = got.wait(timeout=args.seconds)
    observer.stop()
    observer.join()
    target.unlink(missing_ok=True)
    if delivered:
        print("PASS: inotify delivered the create event on this filesystem", flush=True)
        return 0
    print(
        f"FAIL: no event within {args.seconds}s - inotify is not usable here "
        "(rely on the sweep)", flush=True
    )
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("watch", help="watch a dir and report delivered events")
    w.add_argument("dir")
    w.add_argument("--seconds", type=float, default=30.0)
    w.set_defaults(func=cmd_watch)

    wr = sub.add_parser("write", help="write probe files into a dir")
    wr.add_argument("dir")
    wr.add_argument("--count", type=int, default=5)
    wr.add_argument("--interval", type=float, default=1.0)
    wr.set_defaults(func=cmd_write)

    st = sub.add_parser("selftest", help="watcher + writer in one process")
    st.add_argument("dir")
    st.add_argument("--seconds", type=float, default=10.0)
    st.set_defaults(func=cmd_selftest)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
