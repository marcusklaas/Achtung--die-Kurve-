#!/bin/sh

gcc test-server.c -Os -o server.o -Wall -lwebsockets -lm -g

if test $# -gt 0; then 
if test $1 = "run"; then
	./server.o 2> stderr
fi
fi
