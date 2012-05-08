bin_PROGRAMS=kurve-server
kurve_server_SOURCES=server.c
kurve_server_LDADD=-L../lib -lwebsockets -lm

if MINGW                                                                        
kurve_server_CFLAGS:= -w  -I../win32port/win32helpers
kurve_server_LDADD+= -luser32 -ladvapi32 -lkernel32 -lgcc -lws2_32 -lz

else
kurve_server_CFLAGS:= -Werror
endif   

kurve_server_CFLAGS+= -Wall -pthread -std=gnu99 -pedantic -DINSTALL_DATADIR=\"@datadir@\" -DLWS_OPENSSL_CLIENT_CERTS=\"@clientcertdir@\"
