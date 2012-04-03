#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <getopt.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <limits.h>
#include <pthread.h>
#include <assert.h>
#include <errno.h>

#include "../lib/libwebsockets.h"
#include "../cjson/cJSON.c"
#include "server.h"

struct libwebsocket_context *ctx;
static pthread_mutex_t gamelistlock; // need this lock in order to add/ remove stuff from gamelist
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
#include "collision-detection.c"
#include "game.c"
#include "ai.c"
#include "game-system.c"
#include "pencil.c"

int main(int cn, char *crs[]) {
	struct game *gm;
	long start = servermsecs();
	int i, j, games = 3E2, computers = 8;

	srand(start);
	lobby = scalloc(1, sizeof(struct game)); // for silly reasons
	lobby->type = GT_LOBBY;

	for(i = 0; i < games; i++) {
		gm = creategame(GT_AUTO, computers, computers);
		
		for(j = 0; j < computers; j++)
			addcomputer(gm, "hard");
	}
	
	/* does not terminate */

	return 0;
}
