FROM python:3-slim

WORKDIR /usr/src/app

COPY requirements.txt ./
COPY app /usr/src/app
RUN apt install -y python3-pyaudio build-essential \
	&& apt install -y --no-install-recommends ffmpeg \
	&& pip install --no-cache-dir -r requirements.txt \
	&& apt purge -y build-essential \
	&& apt autoremove -y

CMD [ "python", "/usr/src/app/main.py" ]
