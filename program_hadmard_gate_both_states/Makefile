SHELL := /bin/bash

CUDAQ_ENV  ?= /opt/nvidia/cudaq/set_env.sh
CONDA_ENV  ?= cudaq-env
NVQPP      ?= nvq++
SOURCE     := building-kernels.cpp
BINARY     := building-kernels
PORT       ?= 8082

.PHONY: build run-cpu run-gpu test web web-gpu clean

# ── C++ kernel (optional, kept for reference) ────────────────────────────────
build:
	source $(CUDAQ_ENV) && $(NVQPP) -std=c++17 $(SOURCE) -o $(BINARY)

run-cpu: build
	./$(BINARY) qpp-cpu 100

run-gpu: build
	./$(BINARY) nvidia 100

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	/usr/lib/code-server/lib/node tests/smoke.test.js

# ── Web server (CPU simulator, no conda needed) ──────────────────────────────
web:
	@selected_port=$$(python3 -c 'import socket; p=$(PORT); s=socket.socket(); s.settimeout(.1); ok=s.connect_ex(("127.0.0.1",p))!=0; s.close(); print(p if ok else p+1)'); \
	lan_ip=$$(hostname -I | awk '{print $$1}'); \
	printf '\n  Local:   http://127.0.0.1:%s\n  Network: http://%s:%s\n  Note:    CPU preview only (no CUDA-Q backend)\n\n' \
	       "$$selected_port" "$$lan_ip" "$$selected_port"; \
	python3 -m http.server $$selected_port --directory frontend

# ── Web server with CUDA-Q GPU backend (recommended) ────────────────────────
web-gpu:
	@conda run -n $(CONDA_ENV) python3 server.py $(PORT)

clean:
	rm -f $(BINARY) *.qke *.o *.ll.tmp
