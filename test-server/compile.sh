#!/bin/sh

gcc test-server.c -o server.o -lwebsockets -lm -std=gnu99 -g

if test $# -gt 0; then 
if test $1 = "run"; then
	./server.o 2> stderr
fi
fi
