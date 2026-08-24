# Colors

Components consume these semantic roles. Do not introduce component-specific raw values.

| Role | Light | Dark |
|---|---|---|
| background | `oklch(97.7% .012 245)` | `oklch(19% .025 245)` |
| foreground | `oklch(24% .025 245)` | `oklch(94% .018 245)` |
| surface | `oklch(100% 0 0)` | `oklch(23% .03 245)` |
| elevated surface | `oklch(100% 0 0)` | `oklch(27% .035 245)` |
| muted | `oklch(52% .035 245)` | `oklch(70% .03 245)` |
| border | `oklch(88% .025 245)` | `oklch(35% .035 245)` |
| primary | `oklch(52% .22 260)` | `oklch(72% .16 260)` |
| selected | `oklch(93% .055 260)` | `oklch(32% .07 260)` |

Semantic feedback: destructive, warning, success, and info retain their meaning in both themes. Use primary only for the single dominant action in a context. Use `--chart-comparison-1` through `--chart-comparison-4` for categorical data; use positive/negative only for actual outcomes.
