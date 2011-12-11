bin_PROGRAMS=libwebsockets-test-server 
libwebsockets_test_server_SOURCES=test-server.c
libwebsockets_test_server_LDADD=-L../lib -lwebsockets

libwebsockets_test_server_CFLAGS:= -Wall -lm -Werror -std=gnu99 -pedantic -DDATADIR=\"@datadir@\" -DLWS_OPENSSL_CLIENT_CERTS=\"@clientcertdir@\"


clean-local:
	rm -f ./libwebsockets-test-server.key.pem ./libwebsockets-test-server.pem

install-data-local:
	mkdir -p $(DESTDIR)$(datadir)/libwebsockets-test-server
	cp -a test.html favicon.ico libwebsockets-test-server.key.pem libwebsockets-test-server.pem \
		$(DESTDIR)$(datadir)/libwebsockets-test-server

