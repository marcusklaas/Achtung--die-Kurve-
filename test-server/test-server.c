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
static struct game *lobby, *headgame = 0;
static int usrc = 0; // user count
static int gmc = 1; // game count
static unsigned long serverticks = 0; // yes this will underflow, but not fast ;p

#include "helper.c"
#include "game.c"

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
		if(ULTRA_VERBOSE)
			printf("serving HTTP URI %s\n", (char *) in);
		char *ext, mime[32];
		char path[MAX_FILE_REQ_LEN + LOCAL_PATH_LENGTH + 1];

		ext = getFileExt(in);

		/* making sure request is reasonable */
		if(strlen(in) > MAX_FILE_REQ_LEN || strstr(in, ".."))
			break;

		strcpy(path, LOCAL_RESOURCE_PATH);
		strcat(path, in);
		if(!strcmp(in, "/"))
			strcat(path, "index.html");

		if(!strcmp(ext, "ico"))
			strcpy(mime, "image/x-icon");
		else if(!strcmp(ext, "js"))
			strcpy(mime, "text/javascript");
		else if(!strcmp(ext, "css"))
			strcpy(mime, "text/css");
		else if(!strcmp(ext, "ogg"))
			strcpy(mime, "audio/ogg");
		else if(!strcmp(ext, "mp3"))
			strcpy(mime, "audio/mpeg");
		else if(!strcmp(ext, "wav"))
			strcpy(mime, "audio/wav");
		else
			strcpy(mime, "text/html");
			
		if(ULTRA_VERBOSE)
			printf("serving %s, %s\n", path, mime);
			
		if(libwebsockets_serve_http_file(wsi, path, mime))
			fprintf(stderr, "Failed to send file\n");

		free(ext);

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
		if(DEBUG_MODE) printf("LWS_CALLBACK_ESTABLISHED\n");
		iniuser(u, wsi);
		if(DEBUG_MODE) { printf("new user created:\n"); printuser(u); printf("\n"); }
		json = jsoncreate("acceptUser");
		jsonaddnum(json, "playerId", u->id);
		jsonaddnum(json, "tickLength", TICK_LENGTH);
		sendjson(json, u);
		jsondel(json);

		// TODO: we should probably cache either the game or the game list
		sendjson(json = encodegamelist(), u);
		jsondel(json);
		break;

	case LWS_CALLBACK_CLOSED:
		if(DEBUG_MODE) printf("LWS_CALLBACK_CLOSED\n");
		if(u->gm)
			leavegame(u);
		while(u->inputhead) {
			struct userinput *nxthead= u->inputhead->nxt;
			free(u->inputhead);
			u->inputhead= nxthead;
		}
		if(u->name)
			free(u->name);
		break;

	case LWS_CALLBACK_SERVER_WRITEABLE:
		if(ULTRA_VERBOSE) printf("LWS_CALLBACK_SERVER_WRITEABLE. %d queued messages\n", u->sbat);

		for(int i = 0; i < u->sbat; i++) {
			char *s= u->sb[i];
			if(ULTRA_VERBOSE) printf("send msg %s to user %d\n", s + PRE_PADDING, u->id);
			libwebsocket_write(wsi, (unsigned char*) s + PRE_PADDING, strlen(s + PRE_PADDING), LWS_WRITE_TEXT);
			free(s);
		}
		u->sbat = 0;

		break;

	case LWS_CALLBACK_BROADCAST:
		break;

	case LWS_CALLBACK_RECEIVE:
		if(ULTRA_VERBOSE) printf("received: %s\n", inchar);

		json= cJSON_Parse(inchar);
		if(!json) {
			if(DEBUG_MODE) printf("invalid json!\n");
			break;
		}
		mode= jsongetstr(json, "mode");
		if(!mode) {
			printf("no mode specified!\n");
			break;
		}
		if(!strcmp(mode, "chat")) {
			cJSON *j;
			char *msg = jsongetstr(json, "message");

			if(!u->gm) {
				printf("user %d tried to chat, but no one's listening\n", u->id);
				break;
			}

			if(++(u->chats) > MAX_CHATS) {
				printf("user %d is spamming in chat\n", u->id);
				j = jsoncreate("stopSpamming");
				sendjson(j, u);
				jsondel(j);
				break;
			}

			if(strlen(msg) > MAX_CHAT_LENGTH) {
				printf("Chat message by user %d too long. Truncating..\n", u->id);
				msg[MAX_CHAT_LENGTH] = 0;
			}

			j = jsoncreate("chat");
			jsonaddnum(j, "playerId", u->id);
			jsonaddstr(j, "message", duplicatestring(msg));
			sendjsontogame(j, u->gm, u);
			jsondel(j);
		}
		else if(!strcmp(mode, "getTime")) {
			cJSON *j= jsoncreate("time");
			jsonaddnum(j, "time", (int)servermsecs());
			sendjson(j, u);
			jsondel(j);
		}
		else if(!strcmp(mode, "joinLobby")) {
			char *s = jsongetstr(json, "playerName");
			if(strlen(s) < MAX_NAME_LENGTH)
				s[MAX_NAME_LENGTH] = 0;

			if(DEBUG_MODE)
				printf("player %d with name %s joined lobby\n", u->id, s);

			u->name = duplicatestring(s);
			joingame(lobby, u);

			// TODO: send game list. complete list in 1 package or 1 msg for
			// each game? keep up to date or let user ask for refresh?
		}
		else if(!strcmp(mode, "requestGame")) {
			if(DEBUG_MODE) printf("user %d requested game\n", u->id);

			if(u->gm - lobby) {
				printf("user tried to join game. but he is not in lobby. he might not have a name etc.\n");
				break;
			}

			int nmin= jsongetint(json, "minPlayers");
			int nmax= jsongetint(json, "maxPlayers");
			if(0 < nmin && nmin < nmax && nmax < 17) {
				struct game *gm = findgame(nmin, nmax);
				if(!gm)
					gm = creategame(GT_AUTO, nmin, nmax);
				joingame(gm, u);
			}
		}
		else if(!strcmp(mode, "leaveGame")) {
			if(u->gm && u->gm - lobby)
				joingame(lobby, u);
		}
		else if(strcmp(mode, "newInput") == 0) {
			if(++(u->inputs) <= MAX_INPUTS && u->gm
			 && u->gm->state == GS_STARTED && !u->ignoreinput)
				interpretinput(json, u);
		}
		else if(!strcmp(mode, "pencil")) {
			if(u->gm && u->gm->state == GS_STARTED && !u->ignoreinput)
				handlepencilmsg(json, u); 		
		}
		else if(!strcmp(mode, "enableInput")) {
			u->ignoreinput = 0;		
		}
		else if(SHOW_WARNING)
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
	struct libwebsocket_context *context;
	int opts = 0;
	char interface_name[128] = "";
	const char * interface = NULL;

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

	ctx = context;
	lobby = scalloc(1, sizeof(struct game));
	lobby->type = GT_LOBBY;

	printf("server started on port %d\n", port);
	mainloop();

	/* fork code
	n = libwebsockets_fork_service_loop(context);
	if (n < 0) {
		fprintf(stderr, "Unable to fork service loop %d\n", n);
		return 1;
	}
	mainloop();*/

	libwebsocket_context_destroy(context);

	return 0;
}
