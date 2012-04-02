#!/bin/sh

gcc test-server.c -Os -o server.o -Wall -pthread -lwebsockets -lm -g

if test $# -gt 0; then 
if test $1 = "run"; then
	./server.o 2> stderr
fi
fi
