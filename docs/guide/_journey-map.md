# Journey Map — Canonical Reference

> This file defines the task-based journey map used as a footer on every tutorial page.
> Copy the appropriate version (with the correct node highlighted) into each page.
> Do not render this file directly.

---

## The journey (7 tasks)

```
Set up your project → Accept → Choose a tone →
Edit phrases → Apply transforms → Preview → Export
```

---

## Mermaid snippets — one per page

### 01-getting-started/your-first-funscript.md  (Set up your project)
```mermaid
flowchart LR
    A[Set up project]:::here --> B[Accept]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Apply transforms]
    E --> F[Preview]
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 01-getting-started/accept.md  (Accept)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]:::here
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Apply transforms]
    E --> F[Preview]
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 02-tone/choose-a-tone.md  (Choose a tone)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]
    B --> C[Choose tone]:::here
    C --> D[Edit phrases]
    D --> E[Apply transforms]
    E --> F[Preview]
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 02-understand-your-script/phrases-at-a-glance.md  (Edit phrases)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]
    B --> C[Choose tone]
    C --> D[Edit phrases]:::here
    D --> E[Apply transforms]
    E --> F[Preview]
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 03-improve-your-script/apply-a-transform.md  (Apply transforms)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Apply transforms]:::here
    E --> F[Preview]
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 03-improve-your-script/preview-your-changes.md  (Preview)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Apply transforms]
    E --> F[Preview]:::here
    F --> G[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### 04-export-and-use/export.md  (Export)
```mermaid
flowchart LR
    A[Set up project] --> B[Accept]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Apply transforms]
    E --> F[Preview]
    F --> G[Export]:::here
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```
