{{/* Base name for all resources. */}}
{{- define "wavebrowser.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "wavebrowser.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Hostname of the MongoDB service provided by the Bitnami subchart. */}}
{{- define "wavebrowser.mongodbHost" -}}
{{- printf "%s-mongodb" .Release.Name -}}
{{- end -}}
