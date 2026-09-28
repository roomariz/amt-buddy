# Answers pass a grounding check before reaching the user

Every euro amount, m² figure, legal threshold and Compliance verdict in a drafted answer must be traceable to a Tool result or a Tenancy fact; a dedicated `verifyGrounding` step checks this after the Supervisor drafts, regenerates once with a correction note, and otherwise drops the ungrounded claim and asks for the missing fact or points to the official source. This applies to `general` questions too. We accepted the extra latency and complexity because the worst failure for a tenant-facing compliance tool is a confident but wrong legal number, and prompt instructions alone do not prevent that.

## Consequences

General questions cannot quote legal numbers (e.g. the Kappungsgrenze) unless a Tool supplies them. The legal disclaimer on Compliance verdicts is appended by code, not by the prompt.
