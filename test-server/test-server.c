#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <getopt.h>
#include <string.h>
#include <sys/time.h>

#include "../lib/libwebsockets.h"

#define debug 1
#define showwarning 1
#define sbmax 10	// sendbuffer max size

#define gs_lobby 0	// gamestate_lobby
#define jsonaddint cJSON_AddNumberToObject
#define jsonaddstr cJSON_AddStringToObject
#define jsonaddfalse cJSON_AddFalseToObject
#define jsonaddtrue cJSON_AddTrueToObject
#define jsondel	cJSON_Delete
#define lwsprepadding	LWS_SEND_BUFFER_PRE_PADDING
#define lwspostpadding	LWS_SEND_BUFFER_POST_PADDING

static int close_testing;
struct libwebsocket_context *ctx; //mag dit?

#include "../cjson/cJSON.c"
#include "game.c"

enum demo_protocols {
	PROTOCOL_HTTP = 0, //always first
	PROTOCOL_GAME,
	DEMO_PROTOCOL_COUNT //always last
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
		if (libwebsockets_serve_http_file(wsi,
				  LOCAL_RESOURCE_PATH"/index.html", "text/html"))
			fprintf(stderr, "Failed to send HTTP file\n");
		break;

	case LWS_CALLBACK_FILTER_NETWORK_CONNECTION:

		libwebsockets_get_peer_addresses((int)(long)user, client_name,
			     sizeof(client_name), client_ip, sizeof(client_ip));

		fprintf(stderr, "Received network connect from %s (%s)\n",
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
	//int n;
	//unsigned char buf[LWS_SEND_BUFFER_PRE_PADDING + 512 + LWS_SEND_BUFFER_POST_PADDING];
	//unsigned char *p = &buf[LWS_SEND_BUFFER_PRE_PADDING];
	struct user *u = user;
	char *inchar= in;
	cJSON *json;
	char *mode;

	switch (reason) {

	case LWS_CALLBACK_ESTABLISHED:
		if(debug) printf("LWS_CALLBACK_ESTABLISHED\n");
		u->id= usrc++;
		u->wsi= wsi;
		u->sb= malloc(sbmax * sizeof(char**));
		u->sbat= 0;
		u->gm= 0;
		u->name= 0;

		json= jsoncreate("accept");
		jsonaddint(json, "playerId", u->id);
		sendjson(json, u);
		jsondel(json);
		break;
		
	case LWS_CALLBACK_CLOSED:
		if(debug) printf("LWS_CALLBACK_CLOSED\n");
		if(u->gm!=0)
			leavegame(u);
		free(u->sb);
		if(u->name!=0)
			free(u->name);
		break;
		
	case LWS_CALLBACK_SERVER_WRITEABLE:
		if(debug) printf("LWS_CALLBACK_SERVER_WRITEABLE\n");
		while(--u->sbat >= 0){
			char *s= u->sb[u->sbat] + lwsprepadding;
			if(debug) printf("send msg %s\n", s);
			libwebsocket_write(wsi, (unsigned char*) s, strlen(s), LWS_WRITE_TEXT);
			free(u->sb[u->sbat]);
		}
		break;

	case LWS_CALLBACK_BROADCAST:
		/*n = sprintf((char *)p, "%d", u->number++);
		n = libwebsocket_write(wsi, p, n, LWS_WRITE_TEXT);
		if (n < 0) {
			fprintf(stderr, "ERROR writing to socket");
			return 1;
		}
		if (close_testing && u->number == 50) {
			fprintf(stderr, "close tesing limit, closing\n");
			libwebsocket_close_and_free_session(context, wsi,
						       LWS_CLOSE_STATUS_NORMAL);
		}*/
		break;

	case LWS_CALLBACK_RECEIVE:
		if(debug) printf("received: %s\n", inchar);
		
		json= cJSON_Parse(inchar);
		if(json==0){
			if(debug) fprintf(stderr, "invalid json!\n");
			break;
		}
		mode= getjsonstr(json, "mode");

		if(u->gm==0 && strcmp(mode, "requestGame")==0) {
			int nmin, nmax;
			if(debug) printf("requested game\n");
			nmin= getjsonint(json, "minPlayers");
			nmax= getjsonint(json, "maxPlayers");
			u->name= getjsonstr(json, "playerName");
			if(0<nmin && nmin<nmax && nmax<17){
				struct game *gm= findgame(nmin, nmax);
				if(gm==0)
					gm= creategame(nmin, nmax);
				joingame(gm, u);
				//libwebsocket_callback_on_writable(context, wsi);
			}
		}
		else if(u->gm && strcmp(mode, "newInput") == 0) {
			/* parrot the input to rest of game, but not u */
			sendjsontogame(json, u->gm, u); 
		}
		else if(u->gm->state==gs_lobby && strcmp(mode, "leaveGame")==0){
			leavegame(u);
		}
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
	int dt= 50;
	int port = 7681;
	struct libwebsocket_context *context;
	int opts = 0;
	char interface_name[128] = "";
	const char * interface = NULL;
	//cJSON *root = cJSON_Parse("{\"a\":3}");
#ifdef LWS_NO_FORK
	unsigned int oldus = 0;
#endif
	
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
		case 'c':
			close_testing = 1;
			fprintf(stderr, " Close testing mode ");
			break;
		case 'h':
			fprintf(stderr, "Usage: test-server "
					     "[--port=<p>]\n");
			exit(1);
		}
	}

	context = libwebsocket_create_context(port, interface, protocols,
				libwebsocket_internal_extensions,
				NULL, NULL, -1, -1, opts);
	if (context == NULL) {
		fprintf(stderr, "libwebsocket init failed\n");
		return -1;
	}
	ctx= context;

#ifdef LWS_NO_FORK

	fprintf(stderr, " Using no-fork service loop\n");

	while (1) {
		struct timeval tv;

		gettimeofday(&tv, NULL);

		if (((unsigned int)tv.tv_usec - oldus) > dt*1000) {
			mainloop();
			oldus = tv.tv_usec;
		}

		libwebsocket_service(context, 50);
	}

#else

	fprintf(stderr, " Using forked service loop\n");

	n = libwebsockets_fork_service_loop(context);
	if (n < 0) {
		fprintf(stderr, "Unable to fork service loop %d\n", n);
		return 1;
	}

	while (1) {
		mainloop();
		usleep(dt*1000);
	}

#endif

	libwebsocket_context_destroy(context);

	return 0;
}
