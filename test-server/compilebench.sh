#!/bin/sh

gcc benchmarks.c -O3 -o bench -Wall -lwebsockets -lm

if test $# -gt 0; then 
if test $1 = "run"; then
	./server.o 2> stderr
fi
fi
