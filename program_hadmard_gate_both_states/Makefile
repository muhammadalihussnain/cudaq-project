SHELL := /bin/bash

CUDAQ_ENV ?= /opt/nvidia/cudaq/set_env.sh
NVQPP ?= nvq++
SOURCE := building-kernels.cpp
BINARY := building-kernels
PORT ?= 8080

.PHONY: build run-cpu run-gpu test web clean

build:
	source $(CUDAQ_ENV) && $(NVQPP) -std=c++17 $(SOURCE) -o $(BINARY)

run-cpu: build
	./$(BINARY) qpp-cpu 100

run-gpu: build
	./$(BINARY) nvidia 100

test:
	bash tests/frontend-smoke.sh

web:
	selected_port=$$(python3 -c 'import socket; p=$(PORT); s=socket.socket(); s.settimeout(.1); ok=s.connect_ex(("127.0.0.1", p)) != 0; s.close(); print(p if ok else p + 1)'); \
	python3 -m http.server $$selected_port --directory frontend

clean:
	rm -f $(BINARY) *.qke *.o *.ll.tmp
