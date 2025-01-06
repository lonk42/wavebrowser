# Wavebrowser
A stack for recording USB - SDR based radio to file, generating transcriptions aginst those recordings with browsable via a webGUI.

![Transcriber Docker Image](https://img.shields.io/badge/Transcriber%20Docker%20Image-0.0.1-red)
![Helm Chart](https://img.shields.io/badge/Helm%20Chart-0.0.1-red)
![License GPL3.0](https://img.shields.io/badge/License-GPL3.0-blue.svg)

## Docker Compose
```
# Edit docker-compose.yaml as required
docker-compose up -d
```

## Helm
```
git clone https://github.com/lonk42/wavebrowser.git
helm show values wavebrowser/helm/ > values.yaml
# Edit values as needed
helm upgrade --namespace my_namespace --create-namespace -i my_appname wavebrowser/helm/ --values values.yaml
```

### TODO
* Post-process the files to eliminate small ones or blips, this is done already in the application by skipping anything with no transcription but still means they exist when they shouldn't
* Move web app into a react container
* Add a pager to webapp to change day
* Finish helm chart
  * Create a configmap for `rtl_airband.conf` for sdr container
  * Create secrets for mongo credentials
  * I think I can use a loop for the pvcs.yaml instead of statically defining them all
* Build docker image for python transcriber and pipeline to ghcr
* Make config options for python transcriber using ENV vars
