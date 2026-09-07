\# Contributing



Thank you for your interest in contributing to this project.



This document explains how the project was created, how development is structured, and how future contributions should be made.



The goal of this file is to maintain clarity, stability, and transparency in the development process.



\---



\# Project Origin



This project was developed using an \*\*AI-assisted programming workflow\*\*.



The development process involved collaboration between:



• \*\*ChatGPT 5.3\*\*  

• \*\*DeepSeek AI models\*\*  

• \*\*A human project director with no formal programming background\*\*



The human contributor acted as the \*\*architectural guide and decision maker\*\*, defining goals, testing behavior, and directing the evolution of the software.



The AI systems were used as \*\*implementation assistants\*\*, helping translate design ideas into working code and explaining technical concepts throughout development.



This workflow represents a new form of collaborative development where:



Human guidance + AI implementation = working software



\---



\# Development Philosophy



This project prioritizes the following principles:



• clarity of architecture  

• maintainable code  

• deterministic behavior  

• transparent documentation  

• gradual feature expansion  



The goal is \*\*not\*\* to create the most feature-rich encoder immediately.



Instead, the project focuses on building a \*\*clean, understandable foundation\*\* that can grow over time.



\---



\# Documentation First



One of the defining characteristics of this project is \*\*extensive documentation\*\*.



Before adding major features, documentation should be updated.



Important documentation files include:



```



README.md

ARCHITECTURE.md

TECHNICAL.md

CHANGELOG.md

ROADMAP.md



```



These documents should remain synchronized with the codebase.



\---



\# Development Workflow



Development generally follows this process:



1\. Define feature or change

2\. Discuss architecture implications

3\. Implement feature

4\. Test encoding behavior

5\. Update documentation

6\. Record change in CHANGELOG.md



Large architectural changes should be documented in \*\*ARCHITECTURE.md\*\*.



\---



\# Coding Guidelines



The codebase intentionally favors \*\*readability over cleverness\*\*.



Preferred characteristics:



• clear variable names  

• descriptive comments  

• modular structure  

• predictable control flow  



Avoid overly compact code that reduces readability.



The project is intended to remain understandable even to developers with limited experience.



\---



\# Electron Architecture Rules



The project uses a clear separation between the \*\*renderer process\*\* and the \*\*main process\*\*.



Renderer responsibilities:



```



UI logic

folder scanning

display updates

encoding pipeline control



```



Main process responsibilities:



```



system operations

FFmpeg process execution

process management

OS dialogs



```



Renderer code should \*\*not directly perform system-level operations\*\*.



Communication must happen through \*\*IPC\*\*.



\---



\# FFmpeg Integration Rules



FFmpeg execution must always use:



```



child\_process.spawn()



```



Do not switch to `exec()`.



`spawn()` allows real-time telemetry streaming and avoids memory buffering issues.



\---



\# Encoding Behavior



Encoding should remain:



• deterministic  

• sequential  

• predictable  



Running multiple simultaneous FFmpeg encoders is intentionally avoided in the current design.



CPU encoders already saturate available cores efficiently.



\---



\# Telemetry Handling



FFmpeg telemetry is parsed from stderr output.



Key telemetry fields include:



```



time=

fps=

speed=

size=

Duration:



```



These values are parsed using regular expressions.



UI updates are throttled to prevent excessive rendering updates.



\---



\# Commit Guidelines



Future commits should ideally follow this format:



```



feature: added hardware encoder detection

fix: corrected progress calculation

refactor: simplified telemetry parser

docs: updated architecture documentation



```



\---



\# Testing Expectations



After modifying encoding behavior, always test with:



• multiple video files  

• different input formats  

• long video durations  



Ensure:



• encoding completes correctly  

• cancellation works  

• UI remains responsive  



\---



\# AI Collaboration



Because this project was created using AI assistance, contributors are welcome to use AI tools as part of development.



However:



AI suggestions should always be \*\*reviewed and understood before integration\*\*.



The goal is to keep the codebase \*\*deliberate and maintainable\*\*, not automatically generated.



\---



\# Future Contributors



Contributors are encouraged to:



• improve documentation  

• simplify architecture  

• expand encoding capabilities  

• maintain clean code structure  



Feature proposals should align with the project's \*\*long-term roadmap\*\*.



\---



\# Final Note



This project demonstrates an emerging development model:



AI-assisted programming guided by human design and curiosity.



The project exists not only as a practical tool, but also as a \*\*learning exploration into software architecture, media encoding systems, and modern development workflows\*\*.

```





