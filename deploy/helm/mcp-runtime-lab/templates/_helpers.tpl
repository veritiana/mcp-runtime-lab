{{- define "mcp-runtime-lab.name" -}}mcp-runtime-lab{{- end -}}
{{- define "mcp-runtime-lab.namespace" -}}{{ default .Release.Namespace .Values.namespaceOverride }}{{- end -}}
