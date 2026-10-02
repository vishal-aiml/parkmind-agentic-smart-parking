import os
import threading
import time
import webbrowser

import uvicorn

PORT = 8000

def local_url():
    return f"http://parking.localhost:{PORT}/parking/"

def codespaces_url():
    return f"http://localhost:{PORT}/parking/"

def open_browser():
    time.sleep(1.2)
    if os.getenv("CODESPACES", "").lower() == "true":
        return
    webbrowser.open(local_url())

if __name__ == "__main__":
    in_codespaces = os.getenv("CODESPACES", "").lower() == "true"
    print(f"\nParkMind AI parking URL: {local_url()}")
    if in_codespaces:
        print(f"GitHub Codespaces port 8000: {codespaces_url()}")
        print("Use the GitHub PORTS panel to copy the forwarded HTTPS URL for live sharing.")
    print("API docs: http://localhost:8000/docs")
    print("Press CTRL+C to stop.\n")
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("app.main:app", host="0.0.0.0" if in_codespaces else "127.0.0.1", port=PORT, reload=False)
