#!/bin/sh

gcc test-server.c -o server.o -lwebsockets -lm -std=gnu99

if test $# -gt 0 -a $1 = "run"; then
	./server.o 2> stderr
fi
