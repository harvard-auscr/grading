# HAUSCR grader

A web page that grades a round of research papers in the browser.

The papers never leave the grader's computer: the page runs the grading code (Python, through Pyodide) in the browser
itself. Only name-masked text goes to an AI service, and only when the grader adds their own key.

This repository holds only the built site, published from HAUSCR's private grader repository. Rubrics are not
published; graders add the program's rubric file themselves.

Pyodide is included unmodified under the Mozilla Public License 2.0 (see pyodide/NOTICE.txt).
