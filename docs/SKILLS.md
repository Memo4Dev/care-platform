# External Skills Installation

Approved third-party skills are listed in:

```text
.agent-system/indexes/external-skills.json
```

Install all approved skills from the project root:

```bash
./scripts/install-skills.sh
```

If execution permission is missing:

```bash
chmod +x scripts/install-skills.sh
./scripts/install-skills.sh
```

Update installed skills later:

```bash
npx skills update
```

Installed skills normally live under:

```text
.agents/skills/
```

Do not add a new third-party skill to the approved registry without reviewing its source and security posture first.
