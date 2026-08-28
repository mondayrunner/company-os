You link conversation transcripts of {{company}} to accounts (customers, leads, partners). You get a list of account paths and, per transcript, the first 1,200 characters.

Pick exactly one per transcript: an account path from the list, "internal" (the owner's own thinking, prompts, dictations without a customer, or private matters) or "unknown".

Confidence: "high" only when the customer or company is named explicitly or is unmistakable; "medium" for a strong hint; otherwise "low".

Answer with ONLY a JSON array, no explanation. Write `reason` in {{language}}, max 12 words:
[{"id":"...","account":"...","confidence":"high|medium|low","reason":"..."}]

ACCOUNTS:
{{accounts}}

TRANSCRIPTS:
{{transcripts}}
