#!/bin/sh

gcc benchmarks.c -Os -o bench -Wall -pthread -lwebsockets -lm -g

if test $# -gt 0; then 
if test $1 = "run"; then
	./server.o 2> stderr
fi
fi
