# Journey Map — Canonical Reference

> This file defines the task-based journey map used as a footer on every tutorial page.
> Copy the appropriate version (with the correct node highlighted) into each page.
> Do not render this file directly.

---

## The journey (5 tasks — Easy Button path)

```
Set up project → Device awareness → Choose a tone → Edit phrases → Export
```

---

## Mermaid snippets — one per page

### Set up your project
```mermaid
flowchart LR
    A[Set up project]:::here --> B[Device]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### Device awareness
```mermaid
flowchart LR
    A[Set up project] --> B[Device]:::here
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### Choose a tone
```mermaid
flowchart LR
    A[Set up project] --> B[Device]
    B --> C[Choose tone]:::here
    C --> D[Edit phrases]
    D --> E[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### Edit phrases
```mermaid
flowchart LR
    A[Set up project] --> B[Device]
    B --> C[Choose tone]
    C --> D[Edit phrases]:::here
    D --> E[Export]
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```

### Export
```mermaid
flowchart LR
    A[Set up project] --> B[Device]
    B --> C[Choose tone]
    C --> D[Edit phrases]
    D --> E[Export]:::here
    classDef here fill:#6c63ff,color:#fff,stroke:#6c63ff
```
