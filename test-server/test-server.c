#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <getopt.h>
#include <string.h>
#include <sys/time.h>

#include "../lib/libwebsockets.h"
#include "../cjson/cJSON.c"
#include "server.h"

struct libwebsocket_context *ctx;
static struct game *headgame = 0;
static int usrc= 0;	// user count
//static long serverstart = 0; // server start in msec since epoch
static unsigned long serverticks = 0; // yes this will underflow, but not fast ;p

#include "helper.c"
#include "game.c"

enum demo_protocols {
	PROTOCOL_HTTP = 0, // always first
	PROTOCOL_GAME,
	DEMO_PROTOCOL_COUNT // always last
};


#define LOCAL_RESOURCE_PATH "../client"

/* this protocol server (always the first one) just knows how to do HTTP */

static int callback_http(struct libwebsocket_context * context,
		struct libwebsocket *wsi,
		enum libwebsocket_callback_reasons reason, void *user,
							   void *in, size_t len)
{
	char client_name[128];
	char client_ip[128];

	switch (reason) {
	case LWS_CALLBACK_HTTP:
		fprintf(stderr, "serving HTTP URI %s\n", (char *)in);

		if (in && strcmp(in, "/favicon.ico") == 0) {
			if (libwebsockets_serve_http_file(wsi,
			     LOCAL_RESOURCE_PATH"/favicon.ico", "image/x-icon"))
				fprintf(stderr, "Failed to send favicon\n");
			break;
		}
		if (in && strcmp(in, "/game.js") == 0) {
			if (libwebsockets_serve_http_file(wsi,
			     LOCAL_RESOURCE_PATH"/game.js", "text/javascript"))
				fprintf(stderr, "Failed http request\n");
			break;
		}
		if (in && strcmp(in, "/config.js") == 0) {
			if (libwebsockets_serve_http_file(wsi,
			     LOCAL_RESOURCE_PATH"/config.js", "text/javascript"))
				fprintf(stderr, "Failed http request\n");
			break;
		}
		if (in && strcmp(in, "/canvaslayers.js") == 0) {
			if (libwebsockets_serve_http_file(wsi,
			     LOCAL_RESOURCE_PATH"/canvaslayers.js", "text/javascript"))
				fprintf(stderr, "Failed http request\n");
			break;
		}
		if (libwebsockets_serve_http_file(wsi,
				  LOCAL_RESOURCE_PATH"/index.html", "text/html"))
			fprintf(stderr, "Failed to send HTTP file\n");
		break;

	case LWS_CALLBACK_FILTER_NETWORK_CONNECTION:

		libwebsockets_get_peer_addresses((int)(long)user, client_name,
			     sizeof(client_name), client_ip, sizeof(client_ip));

		printf("Received network connect from %s (%s)\n",
							client_name, client_ip);

		/* if we returned non-zero from here, we kill the connection */
		break;

	default:
		break;
	}

	return 0;
}


static int
callback_game(struct libwebsocket_context * context,
			struct libwebsocket *wsi,
			enum libwebsocket_callback_reasons reason,
					       void *user, void *in, size_t len)
{
	struct user *u = user;
	char *inchar= in;
	cJSON *json;
	char *mode;

	switch (reason) {

	case LWS_CALLBACK_ESTABLISHED:
		if(debug) printf("LWS_CALLBACK_ESTABLISHED\n");
		u->id= usrc++;
		u->wsi= wsi;
		u->sbat= 0;
		u->gm= 0;
		u->name= 0;
		u->alive= 0;
		u->inputhead = u->inputtail = 0;
		u->deltaon= u->deltaat= 0;
		if(debug) printf("new user created:\n"); printuser(u); printf("\n");

		json= jsoncreate("acceptUser");
		jsonaddnum(json, "playerId", u->id);
		sendjson(json, u);
		jsondel(json);
		break;
		
	case LWS_CALLBACK_CLOSED:
		if(debug) printf("LWS_CALLBACK_CLOSED\n");
		if(u->gm)
			leavegame(u);
		while(u->inputhead){
			struct userinput *nxthead= u->inputhead->nxt;
			free(u->inputhead);
			u->inputhead= nxthead;
		}
		if(u->name)
			free(u->name);
		break;
		
	case LWS_CALLBACK_SERVER_WRITEABLE:
		if(debug) printf("LWS_CALLBACK_SERVER_WRITEABLE. %d queued messages\n", u->sbat);

		for(int i = 0; i < u->sbat; i++) {
			char *s= u->sb[i];
			if(debug) printf("send msg %s to user %d\n", s + lwsprepadding, u->id);
			libwebsocket_write(wsi, (unsigned char*) s + lwsprepadding, strlen(s + lwsprepadding), LWS_WRITE_TEXT);
			free(s);
		}
		u->sbat = 0;

		break;

	case LWS_CALLBACK_BROADCAST:
		break;

	case LWS_CALLBACK_RECEIVE:
		if(debug) printf("received: %s\n", inchar);
		
		json= cJSON_Parse(inchar);
		if(!json){
			if(debug) printf("invalid json!\n");
			break;
		}
		mode= jsongetstr(json, "mode");
		if(!mode){
			printf("no mode specified!\n");
			break;
		}
		if(!strcmp(mode, "getTime")){
			cJSON *j= jsoncreate("time");
			jsonaddnum(j, "time", (int)epochmsecs());
			sendjson(j, u);
			jsondel(j);
		}
		else if(!u->gm){
			if(!strcmp(mode, "requestGame")) {
				int nmin, nmax;
				char *s;
				if(debug) printf("requested game\n");

				nmin= jsongetint(json, "minPlayers");
				nmax= jsongetint(json, "maxPlayers");
				s= jsongetstr(json, "playerName");
				if(strlen(s) < 50)
					u->name = duplicatestring(s);
				if(0<nmin && nmin<nmax && nmax<17){
					struct game *gm= findgame(nmin, nmax);
					if(gm==0)
						gm= creategame(nmin, nmax);
					joingame(gm, u);
				}
			}
		}
		else if(u->gm->state == GS_LOBBY){
			if(!strcmp(mode, "leaveGame"))
				leavegame(u);
		}
		else if(u->gm->state == GS_STARTED){
			if(strcmp(mode, "newInput") == 0) {
				interpretinput(json, u); 
			}
		}else if(showwarning)
			printf("unkown mode!\n");
		
		jsondel(json);
		break;

	default:
		break;
	}

	return 0;
}

/* list of supported protocols and callbacks */

static struct libwebsocket_protocols protocols[] = {
	/* first protocol must always be HTTP handler */

	{
		"http-only",		/* name */
		callback_http,		/* callback */
		0			/* per_session_data_size */
	},
	{
		"game-protocol",
		callback_game,
		sizeof(struct user),
	},
	{
		NULL, NULL, 0		/* End of list */
	}
};

static struct option options[] = {
	{ "help",	no_argument,		NULL, 'h' },
	{ "port",	required_argument,	NULL, 'p' },
	{ "killmask",	no_argument,		NULL, 'k' },
	{ "interface",  required_argument, 	NULL, 'i' },
	{ "closetest",  no_argument,		NULL, 'c' },
	{ NULL, 0, 0, 0 }
};


int main(int argc, char **argv)
{
	int n = 0;
	int port = 7681;
	//int dt = 50;
	struct libwebsocket_context *context;
	int opts = 0;
	char interface_name[128] = "";
	const char * interface = NULL;
	//cJSON *root = cJSON_Parse("{\"a\":3}");
#ifdef LWS_NO_FORK
	unsigned int oldus = 0;
#endif

	//serverstart = epochmsecs();
	
	/*printf("HI\n");
	if(root!=0)
		n= cJSON_GetObjectItem(root,"a")->valueint;
	if(root!=0)printf("%d", n);
	return 0;*/

	while (n >= 0) {
		n = getopt_long(argc, argv, "ci:khsp:", options, NULL);
		if (n < 0)
			continue;
		switch (n) {
		case 'k':
			opts = LWS_SERVER_OPTION_DEFEAT_CLIENT_MASK;
			break;
		case 'p':
			port = atoi(optarg);
			break;
		case 'i':
			strncpy(interface_name, optarg, sizeof interface_name);
			interface_name[(sizeof interface_name) - 1] = '\0';
			interface = interface_name;
			break;
		case 'h':
			printf("Usage: test-server "
					     "[-p=<p>]\n");
			exit(1);
		}
	}

	context = libwebsocket_create_context(port, interface, protocols,
				libwebsocket_internal_extensions,
				NULL, NULL, -1, -1, opts);
	if (context == NULL) {
		printf("libwebsocket init failed\n");
		return -1;
	}
	ctx= context;
	//printf("server started on port %d\n", port);

#ifdef LWS_NO_FORK

	fprintf(stderr, " Using no-fork service loop\n");
	printf("not yet supported\n");
	return 1;
	
	/*while (1) {
		struct timeval tv;

		gettimeofday(&tv, NULL);

		if (((unsigned int)tv.tv_usec - oldus) > dt*1000) {
			mainloop();
			oldus = tv.tv_usec;
		}

		libwebsocket_service(context, 50);
	}*/

#else

	fprintf(stderr, " Using forked service loop\n");

	n = libwebsockets_fork_service_loop(context);
	if (n < 0) {
		fprintf(stderr, "Unable to fork service loop %d\n", n);
		return 1;
	}

	mainloop();

#endif

	libwebsocket_context_destroy(context);

	return 0;
}
