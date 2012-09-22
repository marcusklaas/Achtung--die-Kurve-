bin_PROGRAMS=kurveserver
kurveserver_SOURCES=server.c
kurveserver_LDADD=-L../lib -lwebsockets -lm
kurveserver_CFLAGS= -g -Wall -O0 -pthread -std=gnu99 -pedantic -DINSTALL_DATADIR=\"@datadir@\" -DLWS_OPENSSL_CLIENT_CERTS=\"@clientcertdir@\"
