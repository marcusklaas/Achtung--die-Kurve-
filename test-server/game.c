void randomizeplayerstarts(struct game *gm) {
	// diameter of your circle in pixels when you turn at max rate
	int diameter = ceil(2.0 * gm->v/ gm->ts);
	struct user *usr;

	if(DEBUG_MODE)
		printf("Entered randomization\n");

	if(gm->map) {
		for(usr = gm->usr; usr; usr = usr->nxt) {
			struct seg seg;
			do {
				usr->x = diameter + rand() % (gm->w - 2 * diameter);
				usr->y =  diameter + rand() % (gm->h - 2 * diameter);
				usr->angle = rand() % 628 / 100.0;
				seg.x1 = usr->x;
				seg.y1 = usr->y;
				seg.x2 = cos(usr->angle) * diameter + usr->x;
				seg.y2 = sin(usr->angle) * diameter + usr->y;
			} while(checkcollision(gm, &seg) != -1.0);

			usr->hstart = gm->hmin + rand() % (gm->hmax - gm->hmin + 1);
		}
	} else {
		/* set the players locs and hstart */
		for(usr = gm->usr; usr; usr = usr->nxt) {
			usr->x = diameter + rand() % (gm->w - 2 * diameter);
			usr->y =  diameter + rand() % (gm->h - 2 * diameter);
			usr->angle = rand() % 628 / 100.0;
			usr->hstart = gm->hmin + rand() % (gm->hmax - gm->hmin + 1);
		}
	}
}

void freesegments(struct seg *seg) {
	struct seg *nxt;
	for(; seg; seg = nxt) {
		nxt = seg->nxt;
		free(seg);
	}
}

cJSON *encodesegments(struct seg *seg) {
	cJSON *ar = cJSON_CreateArray();
	while(seg) {
		cJSON *a = cJSON_CreateObject();
		jsonaddnum(a,"x1", seg->x1);
		jsonaddnum(a,"y1", seg->y1);
		jsonaddnum(a,"x2", seg->x2);
		jsonaddnum(a,"y2", seg->y2);
		cJSON_AddItemToArray(ar, a);
		seg = seg->nxt;
	}
	return ar;
}

cJSON *encodegame(struct game *gm) {
	cJSON *json = cJSON_CreateObject();

	jsonaddnum(json, "id", gm->id);
	jsonaddnum(json, "n", gm->n);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	jsonaddstr(json, "type", gametypetostr(gm->type));
	jsonaddstr(json, "state", statetostr(gm->state));
	return json;
}

cJSON *encodegamelist() {
	struct game *gm;
	cJSON *game, *gmArr, *json = jsoncreate("gameList");
	
	gmArr = cJSON_CreateArray();
	cJSON_AddItemToObject(json, "games", gmArr);

	for(gm = headgame; gm; gm = gm->nxt) {
		game = encodegame(gm);
		cJSON_AddItemToArray(gmArr, game);
	}

	return json;
}

void broadcastgamelist() {
	cJSON *json = encodegamelist();
	sendjsontogame(json, lobby, 0);
	jsondel(json);
}

void startgame(struct game *gm) {
	struct user *usr;

	if(DEBUG_MODE)
		printf("starting game %p!\n", (void*)gm);
	
	if(gm->map) {
		struct seg *seg;
		for(seg = gm->map->seg; seg; seg = seg->nxt)
			addsegment(gm, seg);
	}
	
	// add border segments
	struct seg seg;
	seg.x1 = seg.y1 = seg.y2 = 0;
	seg.x2 = gm->w;
	addsegment(gm, &seg);
	seg.x1 = gm->w;
	seg.y1 = gm->h;
	addsegment(gm, &seg);
	seg.x2 = 0;
	seg.y2 = gm->h;
	addsegment(gm, &seg);
	seg.x1 = seg.y1 = 0;
	addsegment(gm, &seg);
		
	// reset users
	for(usr = gm->usr; usr; usr = usr->nxt){
		usr->turn = 0;
		usr->alive = 1;
		usr->deltaon = usr->deltaat = 0;
		usr->v = gm->v;
		usr->ts = gm->ts;
		usr->hsize = gm->hsize;
		usr->hfreq = gm->hfreq;
		usr->lastinputtick = -1;
		usr->ignoreinput = 1;
		if(gm->pencilmode != PM_OFF)
			resetpencil(&usr->pencil, usr);
	}
	
	gm->rsn = gm->n;
	randomizeplayerstarts(gm);

	int laterround = gm->usr->points || (gm->usr->nxt && gm->usr->nxt->points);
	gm->start = serverticks * TICK_LENGTH + laterround * COOLDOWN + COUNTDOWN;
	gm->tick = -(COUNTDOWN + SERVER_DELAY + laterround * COOLDOWN)/ TICK_LENGTH;
	gm->state = GS_STARTED;
	gm->alive = gm->n;

	// create JSON object
	cJSON *root = jsoncreate("startGame");
	cJSON *start_locations = cJSON_CreateArray();

	/* fill json object */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		cJSON *player = cJSON_CreateObject();
		cJSON_AddNumberToObject(player, "playerId", usr->id);
		cJSON_AddNumberToObject(player, "startX", usr->x);
		cJSON_AddNumberToObject(player, "startY", usr->y);
		cJSON_AddNumberToObject(player, "startAngle", usr->angle);
		cJSON_AddNumberToObject(player, "holeStart", usr->hstart);
		cJSON_AddItemToArray(start_locations, player);
	}

	/* spreading the word to all in the game */
	jsonaddnum(root, "startTime", (int)gm->start);
	cJSON_AddItemToObject(root, "startPositions", start_locations);
	sendjsontogame(root, gm, 0);
	jsondel(root);
}

struct map *createmap(cJSON *j) {
	if(!j)
		return 0;
	struct map *map = scalloc(1, sizeof(struct map));
	while(j) {
		struct seg *seg = smalloc(sizeof(struct seg));
		seg->x1 = jsongetint(j, "x1");
		seg->y1 = jsongetint(j, "y1");
		seg->x2 = jsongetint(j, "x2");
		seg->y2 = jsongetint(j, "y2");
		seg->nxt = map->seg;
		map->seg = seg;
		j = j->next;
	}
	return map;
}

void freemap(struct map *map) {
	freesegments(map->seg);
	free(map);
}

void remgame(struct game *gm) {
	if(DEBUG_MODE)
		printf("deleting game %p\n", (void *) gm);
	gm->state = GS_REMOVING_GAME;
	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}

	struct user *usr, *nxt;
	for(usr = gm->usr; usr; usr = nxt) {
		nxt = usr->nxt;
		joingame(lobby, usr);
	}

	if(gm->map)
		freemap(gm->map);
	free(gm->seg);
	free(gm);
	broadcastgamelist();
}

struct game *findgame(int nmin, int nmax) {
	struct game *gm;

	if(DEBUG_MODE)
		printf("findgame called \n");

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->state == GS_LOBBY && gm->nmin <= nmax && gm->nmax >= nmin && gm->type == GT_AUTO) {
			gm->nmin = max(gm->nmin, nmin);
			gm->nmax = min(gm->nmax, nmax);
			gm->goal = (gm->n - 1) * TWO_PLAYER_POINTS; // c * avg pts pp pr
			cJSON *json = getjsongamepars(gm);
			sendjsontogame(json, gm, 0);
			jsondel(json);
			return gm;
		}

	return 0;
}

// takes game id and returns the game (if it exists and there is a spot)
struct game *searchgame(int gameid) {
	struct game *gm;

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->state == GS_LOBBY && gameid == gm->id && gm->nmax > gm->n)
			return gm;

	return 0;
}

void tellhost(struct game *gm, struct user *usr) {
	cJSON *j = jsoncreate("setHost");
	jsonaddnum(j, "playerId", gm->host->id);
	if(usr)
		sendjson(j, usr);
	else
		sendjsontogame(j, gm, 0);
	jsondel(j);
}

void leavegame(struct user *usr) {
	struct game *gm = usr->gm;
	struct user *curr;

	if(DEBUG_MODE && gm->type != GT_LOBBY)
		printf("user %d is leaving his game!\n", usr->id);

	if(gm->usr == usr) {
		gm->usr = usr->nxt;
	} else {
		for(curr = gm->usr; curr->nxt && curr->nxt != usr; curr = curr->nxt);
		curr->nxt = usr->nxt;
		if(gm->host == usr) {
			gm->host = curr;
			tellhost(gm, 0);
		}
	}

	gm->alive -= usr->alive;
	gm->n--;
	usr->nxt = 0;
	usr->gm = 0;

	// send message to group: this player left
	cJSON *json = jsoncreate("playerLeft");
	jsonaddnum(json, "playerId", usr->id);
	sendjsontogame(json, gm, 0);
	jsondel(json);

	if(gm->type != GT_LOBBY) {
		if(gm->state == GS_STARTED && gm->n == 1)
			endround(gm);
		else if(gm->state != GS_REMOVING_GAME && gm->n == 0)
			remgame(gm);
	}

	if(DEBUG_MODE) printgames();
}

void joingame(struct game *gm, struct user *newusr) {
	struct user *usr;
	cJSON *json;
	char *lastusedname;

	if(newusr->gm)
		leavegame(newusr);

	if(DEBUG_MODE)
		printf("user %d is joining game %p\n", newusr->id, (void*)gm);

	if(!gm->n++)
		broadcastgamelist();

	newusr->gm = gm;
	newusr->inputs = 0;
	newusr->points = 0;

	// tell user s/he joined a game.
	json = jsoncreate("joinedGame");
	jsonaddstr(json, "type", gametypetostr(gm->type));
	sendjson(json, newusr);
	jsondel(json);

	// tell players of game someone new joined
	json = jsoncreate("newPlayer");
	jsonaddnum(json, "playerId", newusr->id);
	jsonaddstr(json, "playerName", lastusedname = newusr->name);
	sendjsontogame(json, gm, 0);

	if(DEBUG_MODE)
		printf("user %d has name %s\n", newusr->id, newusr->name);

	// send a message to the new player for every other player that is already in the game
	for(usr = gm->usr; usr; usr = usr->nxt) {
		jsonsetnum(json, "playerId", usr->id);
		jsonsetstr(json, "playerName", lastusedname = usr->name);
		sendjson(json, newusr);
	}

	jsonsetstr(json, "playerName", duplicatestring(lastusedname));
	jsondel(json);
	
	newusr->nxt = gm->usr;
	gm->usr = newusr;
	if(gm->type == GT_CUSTOM) {
		if(!gm->host)
			gm->host = newusr;
		tellhost(gm, newusr);
	}

	/* send either game details or game list */
	if(gm->type == GT_LOBBY)
		json = encodegamelist();
	else 
		json = getjsongamepars(gm);

	sendjson(json, newusr);
	jsondel(json);

	if(gm->type == GT_AUTO && gm->n >= gm->nmin)
		startgame(gm);

	if(DEBUG_MODE) {
		printf("user %d joined game %p\n", newusr->id, (void *)gm);
		printgames();
	}
}

struct game *creategame(int gametype, int nmin, int nmax) {
	struct game *gm = scalloc(1, sizeof(struct game));

	if(DEBUG_MODE)
		printf("creating game %p\n", (void*)gm);

	gm->id = gmc++;
	gm->type = gametype;
	gm->nmin = nmin; gm->nmax = nmax;
	gm->w = GAME_WIDTH;
	gm->h = GAME_HEIGHT;
	gm->state = GS_LOBBY;
	gm->v = VELOCITY;
	gm->ts = TURN_SPEED;
	gm->pencilmode = PM_DEFAULT;
	gm->nxt = headgame;
	gm->goal = TWO_PLAYER_POINTS;
	headgame = gm;

	gm->hsize = HOLE_SIZE;
	gm->hfreq = HOLE_FREQ;
	gm->hmin = HOLE_START_MIN;
	gm->hmax = HOLE_START_MAX;

	// how big we should choose our tiles depends only on segment length
	float seglen = gm->v * TICK_LENGTH / 1000.0;
	gm->tilew = gm->tileh = ceil(TILE_SIZE_MULTIPLIER * seglen);
	gm->htiles = ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles = ceil(1.0 * gm->h / gm->tileh);
	gm->seg = scalloc(gm->htiles * gm->vtiles, sizeof(struct seg*));

	return gm;
}

// returns -1 if collision, between 0 and 1 other wise
float segcollision(struct seg *seg1, struct seg *seg2) {
	if(seg1->x2 == seg2->x1 && seg1->y2 == seg2->y1)
		return -1;

	float denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	float numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	float numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);
	
	/* segments are parallel */
	if(denom == 0)
		return -1;

	float a = numer_a/ denom;
	float b = numer_b/ denom;

	if(a >= 0 && a <= 1 && b >= 0 && b <= 1)
		return b;

	return -1;
}

// returns 1 in case the segment intersects the box
int lineboxcollision(struct seg *seg, int top, int right, int bottom, int left) {
	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 <= right && seg->y1 <= bottom && seg->y1 >= top)
		return 1;

	if(seg->x2 >= left && seg->x2 <= right && seg->y2 <= bottom && seg->y2 >= top)
		return 1;

	struct seg edge;

	/* check intersect left border */
	edge.x1 = edge.x2 = left;
	edge.y1 = bottom;
	edge.y2 = top;
	if(segcollision(seg, &edge) != -1.0)
		return 1;

	/* check intersect right border */
	edge.x1 = edge.x2 = right;
	if(segcollision(seg, &edge) != -1.0)
		return 1;

	/* check intersect top border */
	edge.x1 = left;
	edge.y1 = edge.y2 = top;
	if(segcollision(seg, &edge) != -1.0)
		return 1;

	/* check intersect bottom border */
	edge.y1 = edge.y2 = bottom;
	if(segcollision(seg, &edge) != -1.0)
		return 1;

	return 0;
}

// returns -1 in case no collision, else between 0 and -1
float checktilecollision(struct seg *tile, struct seg *seg) {
	struct seg *current;
	float cut, mincut = -1;

	for(current = tile; current; current = current->nxt) {
		cut = segcollision(current, seg);

		if(cut != -1.0) {
			mincut = (mincut == -1.0) ? cut : min(cut, mincut);

			if(DEBUG_MODE) {
				printseg(current);printf(" collided with ");printseg(seg);printf("\n");
			}
		}
	}

	return mincut;
}

// fills tileindices: top right bottom left.
// NOTE: bottom means greater y-values 
void tiles(struct game *gm, struct seg *seg, int *tileindices) {
	int swap, fpob, spob;
	float fswap;

	tileindices[3] = floor(seg->x1/ gm->tilew);
	tileindices[1] = floor(seg->x2/ gm->tilew);
	if(tileindices[3] > tileindices[1]) {
		swap = tileindices[3];
		tileindices[3] = tileindices[1];
		tileindices[1] = swap;
	}

	tileindices[2] = floor(seg->y1/ gm->tileh);
	tileindices[0] = floor(seg->y2/ gm->tileh);
	if(tileindices[2] < tileindices[0]) {
		swap = tileindices[2];
		tileindices[2] = tileindices[0];
		tileindices[0] = swap;
	}

	tileindices[3] = max(tileindices[3], 0);
	tileindices[1] = min(tileindices[1], gm->htiles - 1);
	tileindices[0] = max(tileindices[0], 0);
	tileindices[2] = min(tileindices[2], gm->vtiles - 1);
}

// returns -1 in case of no collision, between 0 and 1 else
float checkcollision(struct game *gm, struct seg *seg) {
	int tileindices[4];
	float cut, mincut = -1;
	struct seg *current;

	tiles(gm, seg, tileindices);
	
	for(int i = tileindices[3]; i <= tileindices[1]; i++) {
		for(int j = tileindices[0]; j <= tileindices[2]; j++) {
			if(!lineboxcollision(seg, j * gm->tileh, (i + 1) * gm->tilew,
			 (j + 1) * gm->tileh, i * gm->tilew))
				continue;

			cut = checktilecollision(gm->seg[gm->htiles * j + i], seg);

			if(cut != -1.0)
				mincut = (mincut == -1.0) ? cut : min(cut, mincut);
		}
	}

	return mincut;
}

// simply adds segment to the game -- collision detection and cutoffs happen
// in different functions now
void addsegment(struct game *gm, struct seg *seg) {
	int tileindices[4];
	struct seg *copy;

	tiles(gm, seg, tileindices);

	for(int i = tileindices[3]; i <= tileindices[1]; i++) {
		for(int j = tileindices[0]; j <= tileindices[2]; j++) {
			if(!lineboxcollision(seg, j * gm->tileh, (i + 1) * gm->tilew,
			 (j + 1) * gm->tileh, i * gm->tilew))
				continue;

			copy = copyseg(seg);
			copy->nxt = gm->seg[gm->htiles * j + i];
			gm->seg[gm->htiles * j + i] = copy;
		}
	}
}

// queues player segment to send for debugging
void queueseg(struct game *gm, struct seg *seg) {
	struct seg *copy = copyseg(seg);
	copy->nxt = gm->tosend;
	gm->tosend = copy;
}

// simulate user tick. returns 1 if player dies during this tick, 0 otherwise
int simuser(struct user *usr, int tick) {
	if(usr->inputhead && usr->inputhead->tick == tick) {
		struct userinput *input = usr->inputhead;
		usr->turn = input->turn;
		usr->inputhead = input->nxt;
		free(input);
		if(!usr->inputhead)
			usr->inputtail = 0;
	}
	
	if(usr->gm->pencilmode != PM_OFF)
		simpencil(&usr->pencil);

	usr->inputs *= !!(tick % INPUT_CONTROL_INTERVAL);

	float oldx = usr->x, oldy = usr->y;
	usr->angle += usr->turn * usr->ts * TICK_LENGTH / 1000.0;
	usr->x += cos(usr->angle) * usr->v * TICK_LENGTH / 1000.0;
	usr->y += sin(usr->angle) * usr->v * TICK_LENGTH / 1000.0;
	
	/* zo weer weg
	float a = 70.0/2;
	usr->v += cos(usr->angle) * a / 1000.0 * TICK_LENGTH;
	if(usr->v < 70)
		usr->v = 70;
	else if(usr->v > 105)
		usr->v = 105;*/

	// check if usr in a hole. hole starts _AFTER_ hstart
	if(tick > usr->hstart
	 && ((tick + usr->hstart) % (usr->hsize + usr->hfreq)) < usr->hsize)
		return 0;

	struct seg newseg;
	newseg.x1 = oldx;
	newseg.y1 = oldy;
	newseg.x2 = usr->x;
	newseg.y2 = usr->y;
	
	float cut = checkcollision(usr->gm, &newseg);

	if(cut != -1.0) {
		usr->x = newseg.x2 = (1 - cut) * newseg.x1 + cut * newseg.x2;
		usr->y = newseg.y2 = (1 - cut) * newseg.y1 + cut * newseg.y2;
	}

	addsegment(usr->gm, &newseg);

	if(SEND_SEGMENTS)
		queueseg(usr->gm, &newseg);

	return cut != -1.0;
}

// send message to group: this player died
void deadplayermsg(struct user *usr, int tick) {
	cJSON *json = jsoncreate("playerDied");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddnum(json, "points", usr->points);
	jsonaddnum(json, "tick", tick);
	jsonaddnum(json, "x", usr->x);
	jsonaddnum(json, "y", usr->y);
	sendjsontogame(json, usr->gm, 0);
	jsondel(json);
}

void sendsegments(struct game *gm) {
	if(gm->tosend) {
		cJSON *json = jsoncreate("segments");
		cJSON *ar = encodesegments(gm->tosend);
		freesegments(gm->tosend);
		gm->tosend = 0;
		jsonaddjson(json, "segments", ar);
		sendjsontogame(json, gm, 0);
		jsondel(json);
	}
}

void endgame(struct game *gm, struct user *winner) {
	cJSON *json = jsoncreate("endGame");
	jsonaddnum(json, "winnerId", winner->id);
	sendjsontogame(json, gm, 0);
	jsondel(json);

	printf("game %p ended. winner = %d\n", (void*) gm, winner->id);
	gm->state = GS_ENDED;
}

void endround(struct game *gm) {
	struct user *usr, *winner = 0;
	int maxpoints = 0, secondpoints = 0;
	struct userinput *inp, *nxt;

	if(DEBUG_MODE)
		printf("ending round of game %p\n", (void *) gm);

	/* give survivor his points */
	for(usr = gm->usr; usr && !usr->alive; usr = usr->nxt);
	if(usr)
		usr->points += gm->rsn - 1;

	if(SEND_SEGMENTS)
		sendsegments(gm);

	cJSON *json = jsoncreate("endRound");
	jsonaddnum(json, "winnerId", usr ? usr->id : -1);
	if(usr)
		jsonaddnum(json, "points", usr->points);
	sendjsontogame(json, gm, 0);
	jsondel(json);

	/* check if there is a winner */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		if(usr->points >= maxpoints) {
			winner = usr;
			secondpoints = maxpoints;
			maxpoints = usr->points;
		}
		else if(usr->points > secondpoints)
			secondpoints = usr->points;
	}

	// clean users
	for(usr = gm->usr; usr; usr = usr->nxt){
		for(inp = usr->inputhead; inp; inp = nxt) {
			nxt = inp->nxt;
			free(inp);
		}
		usr->inputhead = usr->inputtail = 0;
		if(gm->pencilmode != PM_OFF)
			cleanpencil(&usr->pencil);
	}
	 
	/* freeing up segments */
	int i, num_tiles = gm->htiles * gm->vtiles;
	for(i =0; i < num_tiles; i++) {
		freesegments(gm->seg[i]);
		gm->seg[i] = 0;
	}

	if((maxpoints >= gm->goal && maxpoints >= secondpoints + MIN_WIN_DIFF) || gm->n == 1) {
		endgame(gm, winner);
	}
	else {
		if(DEBUG_MODE)
			printf("round of game %p ended. round winner = %d\n", (void*) gm, usr ? usr->id : -1);
		startgame(gm);
	}
}

void killplayer(struct user *usr, int reward) {
	usr->gm->alive -= usr->alive--;
	usr->points += reward;
	deadplayermsg(usr, usr->gm->tick);

	if(DEBUG_MODE)
		printf("player %d died\n", usr->id);
}

// simulate game tick
void simgame(struct game *gm) {
	struct user *usr;
	int reward = gm->rsn - gm->alive; // define here for when multiple players die this tick

	if(gm->tick < 0) {
		gm->tick++;
		return;
	}

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr->alive && simuser(usr, gm->tick))
			killplayer(usr, reward);

	gm->tick++;
	if(SEND_SEGMENTS && gm->tick % SEND_SEGMENTS == 0)
		sendsegments(gm);
	
	if(gm->alive <= 1 && (gm->n > 1 || gm->alive < 1))
		endround(gm);
}

static void resetGameChatCounters(struct game *gm) {
	struct user *usr;

	for(usr = gm->usr; usr; usr = usr->nxt)
		usr->chats = 0;
}

// deze functie called simgame zo goed als mogelijk elke TICK_LENGTH msec (voor elke game)
void mainloop() {
	int sleepuntil, resetChat;
	struct game *gm, *nxtgm;
	static int lastheavyloadmsg;

	while(1) {
		resetChat = !(serverticks % SPAM_CHECK_INTERVAL);

		for(gm = headgame; gm; gm = nxtgm) {
			nxtgm = gm->nxt; // in the case that gm gets freed. is this still possible? game only freed after last player leaves
			if(gm->state == GS_STARTED)
				simgame(gm);

			if(resetChat)
				resetGameChatCounters(gm);
		}
		
		if(resetChat)
			resetGameChatCounters(lobby);

		sleepuntil = ++serverticks * TICK_LENGTH;
		if(sleepuntil < servermsecs() - 5 * TICK_LENGTH && servermsecs() - lastheavyloadmsg > 1000) {
			printf("server is under heavy load! %d msec behind on schedule!\n", -sleepuntil);
			lastheavyloadmsg = servermsecs();
		}
		do{
			libwebsocket_service(ctx, max(0, sleepuntil - servermsecs()));
		}while(sleepuntil - servermsecs() > 0);
	}
}

void interpretinput(cJSON *json, struct user *usr) {
	struct userinput *input;
	int turn = jsongetint(json, "turn");
	int tick = jsongetint(json, "tick");
	int time = tick * TICK_LENGTH + TICK_LENGTH/ 2;
	int modified = 0;
	int minimumTick = usr->gm->tick;
	
	// some checks
	if(turn < -1 || turn > 1) {
		if(SHOW_WARNING)
			printf("invalid user input received from user %d.\n", usr->id);
		return;
	}
	if(!usr->alive) {
		if(SHOW_WARNING)
			printf("received input for dead user %d? ignoring..\n", usr->id);
		return;
	}
	if(tick < minimumTick) {
		if(SHOW_WARNING)
			printf("received msg from user %d of %d msec old! tick incremented by %d\n",
			 usr->id, (int) (servermsecs() - usr->gm->start - time), minimumTick - tick);
		tick = minimumTick;
		modified = 1;
	}
	if(tick <= usr->lastinputtick) {
		tick = usr->lastinputtick + 1;
		modified = 1;
	}
	
	// put it in user queue
	usr->lastinputtick = tick;
	input = smalloc(sizeof(struct userinput));
	input->tick = tick;
	input->turn = turn;
	input->nxt = 0;
	if(!usr->inputtail)
		usr->inputhead = usr->inputtail = input;
	else
		usr->inputtail = usr->inputtail->nxt = input;
	
	
	if(SHOW_DELAY) {
		int x = (servermsecs() - usr->gm->start) - time;
		printf("delay: %d\n", x);
	}
	
	// check if user needs to adjust her gametime
	usr->delta[usr->deltaat++] = (servermsecs() - usr->gm->start) - time;
	if(usr->deltaat == DELTA_COUNT) {
		usr->deltaat = 0;
		usr->deltaon = 1;
	}
	if(usr->deltaon) {
		int max = 0, i, tot = 0;
		usr->deltaon = 0;
		for(i = 0;i < DELTA_COUNT; i++) {
			if(usr->delta[i] > max) {
				tot += max;
				max = usr->delta[i];
			}else
				tot += usr->delta[i];
		}
		tot /= (DELTA_COUNT - 1);
		if(abs(tot) > DELTA_MAX) {
			cJSON *j = jsoncreate("adjustGameTime");
			jsonaddnum(j, "forward", tot);
			sendjson(j, usr);
			jsondel(j);
			if(SHOW_WARNING)
				printf("asked user %d to adjust gametime by %d\n", usr->id, tot);
		}
	}
	
	// send to other players
	cJSON *j = jsoncreate("newInput");
	jsonaddnum(j, "tick", tick);
	jsonaddnum(j, "playerId", usr->id);
	jsonaddnum(j, "turn", turn);
	if(modified)
		jsonaddnum(j, "modified", 0);
	sendjsontogame(j, usr->gm, 0);
	jsondel(j);
}

void iniuser(struct user *usr, struct libwebsocket *wsi) {
	memset(usr, 0, sizeof(struct user));
	usr->id = usrc++;
	usr->wsi = wsi;
	usr->lastinputtick = -1;
}

void deleteuser(struct user *usr) {
	int i;
	struct pencilseg *pseg, *nxt;
	
	if(usr->gm)
		leavegame(usr);

	while(usr->inputhead) {
		struct userinput *nxthead = usr->inputhead->nxt;
		free(usr->inputhead);
		usr->inputhead = nxthead;
	}

	if(usr->name)
		free(usr->name);
	
	for(i = 0; i < usr->sbat; i++)
		free(usr->sb[i]);

	if(usr->msgbuf)
		free(usr->msgbuf);

	for(pseg = usr->pencil.pseghead; pseg; pseg = nxt) {
		nxt = pseg->nxt;
		free(pseg);
	}
}

/* pencil game */
void handlepencilmsg(cJSON *json, struct user *u) {
	struct pencil *p = &u->pencil;
	cJSON *j = 0;
	
	json = jsongetjson(json, "data");
	if(!json)
		return;
	json = json->child;
	
	while(json) {
		float x = json->valuedouble, y;
		int tick;
		int newstroke = 0;
		json = json->next;
		if(!json) break;
		y = json->valuedouble;
		json = json->next;
		if(!json) break;
		tick = json->valueint;
		json = json->next;
		if(tick < 0) {
			tick = -tick - 1;
			newstroke = 1;
		}
		if(tick < u->gm->tick)
			tick = u->gm->tick;
		if(!(tick > p->lasttick || (newstroke && tick == p->lasttick)))
			break;
		gototick(p, tick);
		if(newstroke) {
			if(p->ink > MOUSEDOWN_INK - EPS) {
				p->x = x;
				p->y = y;
				p->ink -= MOUSEDOWN_INK;
				p->lasttick = tick - 1; // so that a seg on tick is also possible
			}else
				break;
		}else{
			float d = getlength(p->x - x, p->y - y);
			if((d >= INK_MIN_DISTANCE - EPS || d >= p->ink - EPS) && p->ink > 0) {
				int tickSolid = tick + (INK_VISIBLE + INK_SOLID) / TICK_LENGTH;
				struct pencilseg *pseg = smalloc(sizeof(struct pencilseg));
				struct seg *seg = &pseg->seg;
				cJSON *k = cJSON_CreateObject();
				if(p->ink < d) {
					float a = x - p->x;
					float b = y - p->y;
					a *= p->ink / d;
					b *= p->ink / d;
					x = p->x + a;
					y = p->y + b;
					p->ink = 0;
				}else
					p->ink -= d;
				seg->x1 = p->x;
				seg->y1 = p->y;
				seg->x2 = x;
				seg->y2 = y;
				pseg->tick = tickSolid;
				pseg->nxt = p->pseghead;
				if(p->pseghead)
					p->pseghead->prev = pseg;
				pseg->prev = 0;
				p->pseghead = pseg;
				if(!p->psegtail)
					p->psegtail = pseg;
				p->lasttick = tick;
				jsonaddnum(k, "x1", p->x);
				jsonaddnum(k, "y1", p->y);
				jsonaddnum(k, "x2", x);
				jsonaddnum(k, "y2", y);
				jsonaddnum(k, "playerId", u->id);
				jsonaddnum(k, "tickVisible", tick + INK_VISIBLE / TICK_LENGTH);
				jsonaddnum(k, "tickSolid", tickSolid);
				if(!j)
					j = cJSON_CreateArray();
				cJSON_AddItemToArray(j, k);
				p->x = x;
				p->y = y;
			}else
				break;
		}
	}
	if(j) {
		cJSON *k = jsoncreate("pencil");
		jsonaddjson(k, "data", j);
		sendjsontogame(k, u->gm, 0);
		jsondel(k);
	}
}

void simpencil(struct pencil *p) {
	if(!p->psegtail || p->psegtail->tick != p->usr->gm->tick)
		return;

	struct pencilseg *tail = p->psegtail;

	addsegment(p->usr->gm, &tail->seg);

	if(tail->prev) {
		tail->prev->nxt = 0;
		p->psegtail = tail->prev;
	}
	else
		p->psegtail = p->pseghead = 0;

	free(tail);
}

// to be called at startgame
void resetpencil(struct pencil *p, struct user *u) {
	p->ink = START_INK;
	p->psegtail = p->pseghead = 0;
	p->usr = u;
	p->tick = 0;
	p->lasttick = -1;
}

// to be called at endround
void cleanpencil(struct pencil *pen) {
	struct pencilseg *p = pen->pseghead, *q;
	while(p) {
		q = p->nxt;
		free(p);
		p = q;
	}
}

void gototick(struct pencil *p, int tick) {
	int ticks = tick - p->tick;
	p->ink += ticks * TICK_LENGTH / 1000.0 * INK_PER_SEC;
	if(p->ink > MAX_INK)
		p->ink = MAX_INK;
}
