void randomizeplayerstarts(struct game *gm) {
	int diameter = ceil(2.0 * gm->v/ gm->ts); /* diameter of circle in px when turning at max rate */
	struct user *usr;
		
	for(usr = gm->usr; usr; usr = usr->nxt) {
		struct seg seg;
		int tries = 0;

		do {
			usr->x = diameter + rand() % (gm->w - 2 * diameter);
			usr->y =  diameter + rand() % (gm->h - 2 * diameter);
			usr->angle = rand() % 628 / 100.0;
			seg.x1 = usr->x;
			seg.y1 = usr->y;
			seg.x2 = cos(usr->angle) * diameter + usr->x;
			seg.y2 = sin(usr->angle) * diameter + usr->y;
		} while(gm->map && checkcollision(gm, &seg) != -1.0 && tries++ < MAX_PLAYERSTART_TRIES);

		/* hstart now between 1 and 2 times usr->hsize + usr->hfreq */
		usr->hstart = (1 + rand() % 5000/ 2500.0) * (usr->hsize + usr->hfreq);
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
	if(gm->host)
		jsonaddstr(json, "host", gm->host->name);
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

void newgamelist() {
	if(gamelist)
		free(gamelist);

	gamelist = jsonprint(encodegamelist());
	gamelistlen = strlen(gamelist);
}

void updategamelist() {
	if(!gamelistcurrent) {
		if(DEBUG_MODE)
			printf("updating gamelist \n");
		newgamelist();
		gamelistage = servermsecs();
		gamelistcurrent = 1;
	}
}

void sendgamelist(struct user *usr) {
	updategamelist();

	if(gamelistage > usr->gamelistage) {
		usr->gamelistage = gamelistage;
		sendstr(gamelist, gamelistlen, usr);
	}
}

void broadcastgamelist() {
	struct user *usr;
	static int updateticks = GAMELIST_UPDATE_INTERVAL/ TICK_LENGTH;
	int i = 0, maxsends = ceil(lobby->n * (float) (serverticks % updateticks) / updateticks);

	// should be faster?
	// maxsends = lobby->n * (serverticks % updateticks) / updateticks + 1;

	for(usr = lobby->usr; usr && i++ < maxsends; usr = usr->nxt)
		if(servermsecs() - GAMELIST_UPDATE_INTERVAL > usr->gamelistage)
			sendgamelist(usr);
}

void logstartgame(struct game *gm) {
	loggame(gm, "started! players: %d\n", gm->n);
	if(gm->type == GT_CUSTOM) {
		char *a;
		cJSON *j;

		j = getjsongamepars(gm);
		a = cJSON_Print(j);
		log("%s\n", a);

		free(a);
		jsondel(j);

		if(gm->map) {
			j = encodesegments(gm->map->seg);
			a = cJSON_PrintUnformatted(j);
			log("%s\n", a);

			free(a);
			jsondel(j);
		}
	}
}

void startgame(struct game *gm) {
	struct user *usr;
	cJSON *root, *start_locations;
	int laterround;

	if(DEBUG_MODE)
		printf("starting game %p!\n", (void*)gm);
	
	if(gm->map) {
		struct seg *seg;
		for(seg = gm->map->seg; seg; seg = seg->nxt)
			addsegment(gm, seg);
	}
	
	/* add border segments */
	if(!gm->torus) {
		struct seg seg;
		seg.x1 = seg.y1 = seg.y2 = 0;
		seg.x2 = gm->w - EPS;
		addsegment(gm, &seg);
		seg.x1 = gm->w - EPS;
		seg.y1 = gm->h - EPS;
		addsegment(gm, &seg);
		seg.x2 = 0;
		seg.y2 = gm->h - EPS;
		addsegment(gm, &seg);
		seg.x1 = seg.y1 = 0;
		addsegment(gm, &seg);
	}
		
	/* reset users */
	for(usr = gm->usr; usr; usr = usr->nxt){
		usr->turn = 0;
		usr->alive = 1;
		usr->deltaon = usr->deltaat = 0;
		usr->v = gm->v;
		usr->ts = gm->ts;
		usr->hsize = gm->hsize;
		usr->hfreq = gm->hfreq;
		usr->inputcount = 0;
		usr->lastinputturn = 0;
		usr->lastinputtick = -1;
		usr->ignoreinput = 1;
		clearinputs(usr);

		if(gm->pencilmode != PM_OFF)
			resetpencil(&usr->pencil, usr);
	}
	
	gm->rsn = gm->n;
	randomizeplayerstarts(gm);

	laterround = gm->round++ != 0;
	gm->start = serverticks * TICK_LENGTH + laterround * COOLDOWN + COUNTDOWN;
	gm->tick = -(COUNTDOWN + SERVER_DELAY + laterround * COOLDOWN)/ TICK_LENGTH;
	gm->state = GS_STARTED;
	gm->alive = gm->n;
	gm->modifieds = 0;
	gm->timeadjustments = 0;
	
	if(!laterround) {
		gamelistcurrent = 0;

		logstartgame(gm);
	}

	root = jsoncreate("startGame");
	start_locations = cJSON_CreateArray();

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
	struct map *map = scalloc(1, sizeof(struct map));

	while(j) {
		struct seg *seg = smalloc(sizeof(struct seg));
		seg->x1 = jsongetint(j, "x1");
		seg->y1 = jsongetint(j, "y1");
		seg->x2 = jsongetint(j, "x2");
		seg->y2 = jsongetint(j, "y2");
		
		if(!seginside(seg, MAX_GAME_WIDTH, MAX_GAME_HEIGHT)) {
			warning("some host made custom map with segments outside max boundaries\n");
			free(seg);
			break;
		}
		
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
	struct user *usr, *nxt;
	
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

	for(usr = gm->usr; usr; usr = nxt) {
		nxt = usr->nxt;
		joingame(lobby, usr);
	}

	if(gm->map)
		freemap(gm->map);
	free(gm->seg);
	free(gm);

	gamelistcurrent = 0;
}

struct game *findgame(int nmin, int nmax) {
	struct game *gm, *bestgame = 0;

	if(DEBUG_MODE)
		printf("findgame called \n");

	/* get oldest suitable game */
	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->state == GS_LOBBY && gm->nmin <= nmax && gm->nmax >= nmin && gm->type == GT_AUTO)
			bestgame = gm;
			
	if(bestgame) {
		cJSON *json;
		gm = bestgame;
		gm->nmin = max(gm->nmin, nmin);
		gm->nmax = min(gm->nmax, nmax);
		gm->goal = 20; // TEMP REMOVAL // ceil(roundavgpts(gm->n + 1, gm->pointsys) * AUTO_ROUNDS);
		json = getjsongamepars(gm);
		sendjsontogame(json, gm, 0);
		jsondel(json);
	}
	
	return bestgame;
}

/* takes game id and returns pointer to game */
struct game *searchgame(int gameid) {
	struct game *gm;

	for(gm = headgame; gm && gameid != gm->id; gm = gm->nxt);

	return gm;
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
	cJSON *json;

	if(DEBUG_MODE && gm->type != GT_LOBBY)
		printf("user %d is leaving his game!\n", usr->id);

	if(gm->state == GS_STARTED && usr->alive)
		killplayer(usr);
	
	if(gm->state == GS_STARTED)
		logplayer(usr, "left game before endgame\n");


	/* remove user from linked list and swap host if necessary */
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

	gm->n--;
	usr->nxt = 0;
	usr->gm = 0;

	/* send message to group: this player left */
	json = jsoncreate("playerLeft");
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

	if(newusr->gm)
		leavegame(newusr);

	if(DEBUG_MODE)
		printf("user %d is joining game %p\n", newusr->id, (void*)gm);

	newusr->gm = gm;
	newusr->points = 0;

	/* set newusr->index */
	if(gm->type != GT_LOBBY) {
		int i;
		for(i = 0; i < MAX_USERS_IN_GAME; i++) {
			for(usr = gm->usr; usr && usr->index != i; usr = usr->nxt);
			if(!usr)
				break;
		}
		newusr->index = i;
	}

	/* add user to game */
	newusr->nxt = gm->usr;
	gm->usr = newusr;
	gm->n++;
	if(gm->type == GT_CUSTOM) {
		if(!gm->host)
			gm->host = newusr;
		tellhost(gm, newusr);
	}

	/* tell user s/he joined a game */
	json = jsoncreate("joinedGame");
	jsonaddstr(json, "type", gametypetostr(gm->type));
	jsonaddnum(json, "index", newusr->index);
	sendjson(json, newusr);
	jsondel(json);

	/* tell players of game someone new joined and send a message to the new player for every other player that is already in the game */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		json = jsoncreate("newPlayer");
		jsonaddnum(json, "playerId", newusr->id);
		jsonaddnum(json, "index", newusr->index);
		jsonaddstr(json, "playerName", newusr->name);
		if(usr == newusr)
			sendjsontogame(json, gm, newusr);
		else
			sendjson(json, newusr);
		jsondel(json);
	}

	/* send either game details or game list */
	if(gm->type == GT_LOBBY)
		sendgamelist(newusr);
	else {
		json = getjsongamepars(gm);
		sendjson(json, newusr);
		jsondel(json);
		
		if(gm->map)
			sendmap(gm->map, newusr);
	}

	if(gm->type == GT_AUTO && gm->n >= gm->nmin)
		startgame(gm);

	/* tell everyone in lobby of new game */
	if(gm->n == 1) {
		json = encodegame(gm);
		cJSON_AddStringToObject(json, "mode", "newGame");
		sendjsontogame(json, lobby, newusr);
		newgamelist();
	}
	
	gamelistcurrent = 0;

	if(DEBUG_MODE) {
		printf("user %d joined game %p\n", newusr->id, (void *)gm);
		printgames();
	}
}

struct game *creategame(int gametype, int nmin, int nmax) {
	struct game *gm = scalloc(1, sizeof(struct game));
	float seglen;
	
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
	gm->pointsys = pointsystem_rik;
	gm->nxt = headgame;
	gm->goal = 20; /* TEMP REMOVAL // ceil(AUTO_ROUNDS * roundavgpts(2, gm->pointsys)); */
	gm->torus = TORUS_MODE;
	gm->inkcap = MAX_INK;
	gm->inkregen = INK_PER_SEC;
	gm->inkdelay = INK_SOLID;
	gm->inkstart = START_INK;
	gm->inkmousedown = MOUSEDOWN_INK;
	gm->round = 0;
	gm->hsize = HOLE_SIZE;
	gm->hfreq = HOLE_FREQ;
	headgame = gm;

	/* how big we should choose our tiles depends only on segment length */
	seglen = gm->v * TICK_LENGTH / 1000.0;
	gm->tilew = gm->tileh = ceil(TILE_SIZE_MULTIPLIER * seglen);
	gm->htiles = ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles = ceil(1.0 * gm->h / gm->tileh);
	gm->seg = scalloc(gm->htiles * gm->vtiles, sizeof(struct seg*));

	return gm;
}

/* returns -1 if collision, between 0 and 1 other wise */
float segcollision(struct seg *seg1, struct seg *seg2) {
	float denom, numer_a, numer_b, a, b;
	
	if(seg1->x2 == seg2->x1 && seg1->y2 == seg2->y1)
		return -1;

	denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);
	
	/* segments are parallel */
	if(fabs(denom) < EPS)
		return -1;

	a = numer_a/ denom;
	b = numer_b/ denom;

	if(a >= 0 && a <= 1 && b >= 0 && b <= 1)
		return b;

	return -1;
}

/* returns 1 in case the segment intersects the box */
int lineboxcollision(struct seg *seg, int top, int right, int bottom, int left) {
	struct seg edge;

	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 <= right && seg->y1 <= bottom && seg->y1 >= top)
		return 1;

	if(seg->x2 >= left && seg->x2 <= right && seg->y2 <= bottom && seg->y2 >= top)
		return 1;

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

/* returns -1 in case no collision, else between 0 and -1 */
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
			if(SAVE_COLLISION_TO_FILE) {
				char y[200];
				FILE *f;
				
				srand(servermsecs());
				sprintf(y,"%d",rand());
				f=fopen(y,"w");
				fwrite(current,sizeof(struct seg),1,f);
				fwrite(seg,sizeof(struct seg),1,f);
				fclose(f);
				printf("collision written to file %s\n",y);
			}
		}
	}

	return mincut;
}

/* fills tileindices: top right bottom left.
 * NOTE: bottom means greater y-values */
void tiles(struct game *gm, struct seg *seg, int *tileindices) {
	int swap;

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

/* returns -1 in case of no collision, between 0 and 1 else */
float checkcollision(struct game *gm, struct seg *seg) {
	int i, j, tileindices[4];
	float cut, mincut = -1;

	tiles(gm, seg, tileindices);
	
	for(i = tileindices[3]; i <= tileindices[1]; i++) {
		for(j = tileindices[0]; j <= tileindices[2]; j++) {
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

/* adds segment to the game. does not check for collision */
void addsegment(struct game *gm, struct seg *seg) {
	int i, j, tileindices[4];
	struct seg *copy;

	tiles(gm, seg, tileindices);

	for(i = tileindices[3]; i <= tileindices[1]; i++) {
		for(j = tileindices[0]; j <= tileindices[2]; j++) {
			if(!lineboxcollision(seg, j * gm->tileh, (i + 1) * gm->tilew,
			 (j + 1) * gm->tileh, i * gm->tilew))
				continue;

			copy = copyseg(seg);
			copy->nxt = gm->seg[gm->htiles * j + i];
			gm->seg[gm->htiles * j + i] = copy;
		}
	}
}

/* queues player segment to send for debugging */
void queueseg(struct game *gm, struct seg *seg) {
	struct seg *copy = copyseg(seg);
	copy->nxt = gm->tosend;
	gm->tosend = copy;
}

/* simulate user tick. returns 1 if player dies during this tick, 0 otherwise
 * warning: this function can be called multiple times with same tick value   */
int simuser(struct user *usr, int tick) {
	int inhole, inside;
	float cut, oldx = usr->x, oldy = usr->y, oldangle = usr->angle;
	struct seg newseg;
	
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

	usr->angle += usr->turn * usr->ts * TICK_LENGTH / 1000.0;
	usr->x += cos(usr->angle) * usr->v * TICK_LENGTH / 1000.0;
	usr->y += sin(usr->angle) * usr->v * TICK_LENGTH / 1000.0;
	
	inhole = (tick > usr->hstart
	 && ((tick + usr->hstart) % (usr->hsize + usr->hfreq)) < usr->hsize);
	inside = usr->x >= 0 && usr->x <= usr->gm->w && usr->y >= 0 && usr->y <= usr->gm->h;

	/* we still collide with map border while in hole */
	if(inhole && inside)
		return 0;

	newseg.x1 = oldx;
	newseg.y1 = oldy;
	newseg.x2 = usr->x;
	newseg.y2 = usr->y;

	cut = checkcollision(usr->gm, &newseg);

	if(cut != -1.0) {
		usr->x = newseg.x2 = (1 - cut) * newseg.x1 + cut * newseg.x2;
		usr->y = newseg.y2 = (1 - cut) * newseg.y1 + cut * newseg.y2;
	}

	if(!inhole) {
		addsegment(usr->gm, &newseg);
		
		if(SEND_SEGMENTS)
			queueseg(usr->gm, &newseg);
	}

	if(cut != -1.0)
		return 1;

	/* wrap around */
	if(!inside) {
		if(usr->x > usr->gm->w)
			usr->x = oldx - usr->gm->w;
		else if(usr->x < 0)
			usr->x = oldx + usr->gm->w;

		if(usr->y > usr->gm->h)
			usr->y = oldy - usr->gm->h;
		else if(usr->y < 0)
			usr->y = oldy + usr->gm->h;

		/* reset angle and simulate this tick again. usr->turn will keep the right value. */
		usr->angle = oldangle;
		return simuser(usr, tick);
	}

	return 0;
}

/* send message to group: this player died */
void deadplayermsg(struct user *usr, int tick, int reward) {
	cJSON *json = jsoncreate("playerDied");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddnum(json, "reward", reward);
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
	struct user *usr;
	
	cJSON *json = jsoncreate("endGame");
	jsonaddnum(json, "winnerId", winner->id);
	sendjsontogame(json, gm, 0);
	jsondel(json);

	if(DEBUG_MODE)
		printf("game %p ended. winner = %d\n", (void*) gm, winner->id);

	gamelistcurrent = 0;
	gm->state = (gm->type == GT_AUTO) ? GS_ENDED : GS_LOBBY;

	if(gm->state == GS_LOBBY) {
		gm->round = 0;

		for(usr = gm->usr; usr; usr = usr->nxt)
			usr->points = 0;
	}
}

void endround(struct game *gm) {
	struct user *usr, *roundwinner, *winner = gm->usr; /* winner until proven otherwise */
	int maxpoints = 0, secondpoints = 0;
	cJSON *json;
	int i, num_tiles = gm->htiles * gm->vtiles;

	if(DEBUG_MODE)
		printf("ending round of game %p\n", (void *) gm);

	loggame(gm, "ended. duration: %3d sec, modifieds: %3d, timeadjustments: %3d\n", 
		gm->tick * TICK_LENGTH / 1000, gm->modifieds, gm->timeadjustments);

	if(SEND_SEGMENTS)
		sendsegments(gm);

	for(roundwinner = gm->usr; roundwinner && !roundwinner->alive;
	 roundwinner = roundwinner->nxt);

	json = jsoncreate("endRound");
	jsonaddnum(json, "winnerId", roundwinner ? roundwinner->id : -1);
	jsonaddnum(json, "finalTick", gm->tick);
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
	 
	/* freeing up segments */
	for(i = 0; i < num_tiles; i++) {
		freesegments(gm->seg[i]);
		gm->seg[i] = 0;
	}

	if((maxpoints >= gm->goal && maxpoints >= secondpoints + MIN_WIN_DIFF) || gm->n == 1) {
		endgame(gm, winner);
	}
	else {
		if(DEBUG_MODE)
			printf("round of game %p ended. round winner = %d\n", (void*) gm, roundwinner ? roundwinner->id : -1);
		startgame(gm);
	}
}

void killplayer(struct user *victim) {
	struct game *gm = victim->gm;
	struct user *usr;
	int reward = gm->pointsys(gm->rsn, gm->alive -= victim->alive--);
	
	if(gm->pencilmode == PM_ONDEATH) {
		victim->pencil.tick = gm->tick;
	}

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr->alive)
			usr->points += reward;
	
	deadplayermsg(victim, gm->tick, reward);

	if(DEBUG_MODE)
		printf("player %d died\n", victim->id);
}

/* simulate game tick */
void simgame(struct game *gm) {
	struct user *usr;

	if(gm->tick < 0) {
		gm->tick++;
		return;
	}

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr->alive && simuser(usr, gm->tick))
			killplayer(usr);

	if(SEND_SEGMENTS && gm->tick % SEND_SEGMENTS == 0)
		sendsegments(gm);
	
	if(gm->alive <= 1 && (gm->n > 1 || gm->alive < 1))
		endround(gm);
	else
		gm->tick++;
}

/* tries to simgame every game every TICK_LENGTH milliseconds */
void mainloop() {
	int sleepuntil;
	struct game *gm;
	static int lastheavyloadmsg;

	while(1) {
		for(gm = headgame; gm; gm = gm->nxt) {
			if(gm->state == GS_STARTED)
				simgame(gm);

			resetspamcounters(gm, serverticks);
		}
		
		broadcastgamelist();
		resetspamcounters(lobby, serverticks);
		sleepuntil = ++serverticks * TICK_LENGTH;

		if(sleepuntil < servermsecs() - 3 * TICK_LENGTH && servermsecs() - lastheavyloadmsg > 1000) {
			warning("%d msec behind on schedule!\n", servermsecs() - sleepuntil);
			lastheavyloadmsg = servermsecs();
		}

		do { libwebsocket_service(ctx, max(0, sleepuntil - servermsecs())); }
		while(sleepuntil - servermsecs() > 0);
	}
}

void interpretinput(cJSON *json, struct user *usr) {
	struct userinput *input;
	int turn = jsongetint(json, "turn");
	int tick = jsongetint(json, "tick");
	int delay, msgtick = tick;
	int time = tick * TICK_LENGTH + TICK_LENGTH/ 2;
	cJSON *j;
	
	/* some checks */
	if(turn < -1 || turn > 1 || turn == usr->lastinputturn) {
		if(SHOW_WARNING)
			printf("invalid user input received from user %d.\n", usr->id);
		return;
	}
	if(!usr->alive) {
		if(SHOW_WARNING)
			printf("received input for dead user %d? ignoring..\n", usr->id);
		return;
	}

	if(tick < usr->gm->tick) {
		if(SHOW_WARNING)
			printf("received msg from user %d of %d msec old! tick incremented by %d\n",
			 usr->id, (int) (servermsecs() - usr->gm->start - time), usr->gm->tick - tick);
		tick = usr->gm->tick;
	}
	if(tick <= usr->lastinputtick)
		tick = usr->lastinputtick + 1;
	delay = tick - msgtick;

	if(delay)
		usr->gm->modifieds++;
	
	/* put it in user queue */
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
	
	/* check if user needs to adjust her gametime */
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
			}
			else
				tot += usr->delta[i];
		}

		tot /= (DELTA_COUNT - 1);

		if(abs(tot) > DELTA_MAX) {
			j = jsoncreate("adjustGameTime");
			jsonaddnum(j, "forward", tot);
			sendjson(j, usr);
			jsondel(j);
			if(ULTRA_VERBOSE)
				printf("asked user %d to adjust gametime by %d\n", usr->id, tot);
			usr->gm->timeadjustments++;
		}
	}

	steermsg(usr, tick, turn, delay);
	usr->lastinputtick = tick;
	usr->lastinputturn = turn;
	usr->inputcount++;
}

void clearinputs(struct user *usr) {
	struct userinput *inp, *nxt;

	for(inp = usr->inputhead; inp; inp = nxt) {
		nxt = inp->nxt;
		free(inp);
	}

	usr->inputhead = usr->inputtail = 0;
}

void iniuser(struct user *usr, struct libwebsocket *wsi) {
	memset(usr, 0, sizeof(struct user));
	usr->id = usrc++;
	usr->wsi = wsi;
}

void deleteuser(struct user *usr) {
	int i;
	
	if(usr->gm)
		leavegame(usr);

	clearinputs(usr);
	cleanpencil(&(usr->pencil));

	if(usr->name)
		free(usr->name);
	
	for(i = 0; i < usr->sbat; i++)
		free(usr->sb[i]);

	if(usr->recvbuf)
		free(usr->recvbuf);
}

/* pencil game */
void handlepencilmsg(cJSON *json, struct user *u) {
	struct pencil *p = &u->pencil;
	struct buffer buf;
	int lasttick = -1;
	char buffer_empty = 1;
	
	json = jsongetjson(json, "data");
	if(!json)
		return;
	json = json->child;
	
	buf.start = 0;
	allocroom(&buf, 200);
	appendheader(&buf, MODE_PENCIL, u->index);
	
	while(json) {
		int x, y;
		int tick;
		char type;

		if(ULTRA_VERBOSE)
			printf("start reading next pencil block .. ");
		
		/* read next block */
		type = json->valueint;
		if(!(json = json->next)) break;
		x= json->valueint;
		if(!(json = json->next)) break;
		y = json->valueint;
		if(!(json = json->next)) break;
		tick = json->valueint;
		json = json->next;

		if(ULTRA_VERBOSE)
			printf("done\n");
		
		if(tick < p->tick || x < 0 || y < 0 || x > u->gm->w || y > u->gm->h) {
			warningplayer(u, "error: wrong pencil location or tick\n");
			break;
		}
		gototick(p, tick);

		if(type == 1) {
			if(p->ink > MOUSEDOWN_INK - EPS) {
				p->x = x;
				p->y = y;
				p->ink -= MOUSEDOWN_INK;
				p->down = 1;
				
				allocroom(&buf, 4);
				appendpos(&buf, x, y);
				appendpencil(&buf, 1, 0);
				
				buffer_empty = 0;
			} else {
				warning("error: not enough ink for pencil down\n");
				break;
			}
		} else {
			float d = getlength(p->x - x, p->y - y);
			if(p->ink < d - EPS || !p->down) {
				warningplayer(u, "error: pencil move: not enough ink or pencil not down, down: %d, ink difference: %f\n", p->down, d - p->ink);
				break;
			}
			p->ink -= d;
			if(type == -1 || d >= INK_MIN_DISTANCE) {
				int tickSolid = max(tick, u->gm->tick) + u->gm->inkdelay / TICK_LENGTH; // FIXME: should be non-decreasing
				struct pencilseg *pseg = smalloc(sizeof(struct pencilseg));
				struct seg *seg = &pseg->seg;

				allocroom(&buf, 6);
				appendpos(&buf, x, y);
				if(lasttick == -1) {
					appendpencil_full(&buf, 0, tickSolid);
				} else {
					if(tickSolid - lasttick > 63) {
						warningplayer(u, "error: pencil move: too large tick gap of %d\n", tickSolid - lasttick);
						buf.at -= 3;
						break;
					}
					appendpencil(&buf, 0, tickSolid - lasttick);
				}
				lasttick = tickSolid;
				buffer_empty = 0;
				
				/* queue pencil segment for simulation */
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
				
				p->x = x;
				p->y = y;
				if(type == -1)
					p->down = 0;
			} else {
				warningplayer(u, "error: too short distance for pencil move: %f\n", d);
				break;
			}
		}
	}
	
	if(!buffer_empty)
		sendstrtogame(buf.start, buf.at - buf.start, u->gm, 0);
	
	free(buf.start);
}

void simpencil(struct pencil *p) {
	struct pencilseg *tail;
	
	while((tail = p->psegtail) && tail->tick <= p->usr->gm->tick) { // <= should not be necessary
		addsegment(p->usr->gm, &tail->seg);
		if(SEND_SEGMENTS)
			queueseg(p->usr->gm, &tail->seg);

		if(tail->prev) {
			tail->prev->nxt = 0;
			p->psegtail = tail->prev;
		}
		else
			p->psegtail = p->pseghead = 0;

		free(tail);
	}
}

/* to be called at startgame */
void resetpencil(struct pencil *p, struct user *u) {
	p->ink = START_INK;
	cleanpencil(p);
	p->usr = u;
	p->tick = 0;
	p->down = 0;
}

void cleanpencil(struct pencil *pen) {
	struct pencilseg *curr, *nxt;

	for(curr = pen->pseghead; curr; curr = nxt) {
		nxt = curr->nxt;
		free(curr);
	}

	pen->pseghead = pen->psegtail = 0;
}

void gototick(struct pencil *p, int tick) {
	int ticks = tick - p->tick;
	float inc = ticks * TICK_LENGTH / 1000.0 * p->usr->gm->inkregen;

	p->ink = min(p->ink + inc, p->usr->gm->inkcap);
}

/* point systems specify how many points the remaining players get when
 * someone dies */
int pointsystem_trivial(int players, int alive) {
	return 1;
}

int pointsystem_wta(int players, int alive) {
	return alive == 1;
}

int pointsystem_rik(int players, int alive) {
	int points[] = {
		6,0,0,0,0,0,0,0,
		6,2,0,0,0,0,0,0,
		6,3,1,0,0,0,0,0,
		6,4,2,1,0,0,0,0
	};
	int map[] = {-1, 0,0, 1, 2,2,2, 3,3};
	
	return points[map[players] * 8 + alive - 1] - points[map[players] * 8 + alive];
}
