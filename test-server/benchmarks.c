#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <getopt.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "../lib/libwebsockets.h"
#include "../cjson/cJSON.c"
#include "server.h"

struct libwebsocket_context *ctx;
static struct game *lobby, *headgame = 0;
static int usrc = 0; // user count
static int gmc = 1; // game count
static unsigned long serverticks = 0;
static char *gamelist = 0; // JSON string
static int gamelistlen = 0; // strlen of gamelist
static int gamelistage = 0; // servermsecs() on which encodedgamelist was last updated
static char gamelistcurrent = 1; // 0 if gamelist is not up to date
static int lastlogtime, lastwarninglogtime;
static int spam_maxs[SPAM_CAT_COUNT] = {SPAM_JOINLEAVE_MAX, SPAM_CHAT_MAX,
 SPAM_SETTINGS_MAX, SPAM_STEERING_MAX};
static int spam_intervals[SPAM_CAT_COUNT] = {SPAM_JOINLEAVE_INTERVAL, SPAM_CHAT_INTERVAL,
 SPAM_SETTINGS_INTERVAL, SPAM_STEERING_INTERVAL};

#include "helper.c"
#include "game.c"

int main(int cn, char *crs[]) {
	struct game *gm;
	long start = servermsecs();
	int games = 3;
	int computers = 3;

	gm = creategame(GT_CUSTOM, computers, computers);
	lobby = scalloc(1, sizeof(struct game)); // for silly reasons
	lobby->type = GT_LOBBY;

	srand(start);

	while(computers--)
		addcomputer(gm);

	gm->usr->inputmechanism = inputmechanism_marcusai;

	while(games--)
		for(startgame(gm); gm->state == GS_STARTED; serverticks++)
			simgame(gm);

	printf("\n\n\n%lu ticks took %lu msecs\n", serverticks, servermsecs() - start);

	return 0;
}
