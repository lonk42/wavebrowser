FROM python:3-slim

WORKDIR /usr/src/app

COPY requirements.txt ./
COPY app /usr/src/app
RUN pip install --no-cache-dir -r requirements.txt \
	&& apt install -y python3-pyaudio build-essential \
	&& apt install -y --no-install-recommend ffmpeg \
	&& apt purge -y build-essential \
	&& apt autoremove -y

CMD [ "python", "/usr/src/app/main.py" ]
