{{- define "poe2-filter.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "poe2-filter.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "poe2-filter.name" . }}
{{- end }}
{{- end }}

{{- define "poe2-filter.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "poe2-filter.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "poe2-filter.selectorLabels" -}}
app.kubernetes.io/name: {{ include "poe2-filter.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
