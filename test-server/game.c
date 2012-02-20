void randomizeplayerstarts(struct game *gm) {
	int i, borderwidth, borderheight, diameter = gm->ts > 0 ? 2.0 * gm->v/ gm->ts : 9999; /* diameter of circle in px when turning at max rate */
	struct user *usr;
	struct seg *starts[MAX_USERS_IN_GAME];
	
	borderwidth = min(gm->w / 3, max(gm->w / 10, diameter)); 
	borderheight = min(gm->h / 3, max(gm->h / 10, diameter)); 

	// random distribution of playerstarts
	if(gm->map) {
		struct seg *seg;
		int spotsleft = 0, playersleft = gm->n;
		int permutation[MAX_USERS_IN_GAME], permutationindex = 0;

		for(i = 0; i < gm->n; i++) {
			permutation[i] = i;
			starts[i] = 0;
		}

		for(seg = gm->map->playerstarts; seg; seg = seg->nxt)
			if(seg->x1 >= 0 && seg->x1 <= gm->w && seg->y1 >= 0 && seg->y1 <= gm->h)
				spotsleft++;

		for(seg = gm->map->playerstarts; seg; seg = seg->nxt) {
			if(rand() % 1000 < 1000 * playersleft / spotsleft) {
				if(seg->x1 >= 0 && seg->x1 <= gm->w && seg->y1 >= 0 && seg->y1 <= gm->h) {
					int j = rand() % playersleft + permutationindex;
					int player = permutation[j];
					starts[player] = seg;
					permutation[j] = permutation[permutationindex++];
					if(!--playersleft)
						break;
				}
			}
			spotsleft--;
		}
	}
	
	i = 0;
	for(usr = gm->usr; usr; usr = usr->nxt) {
		int tries = 0;
		struct seg seg;

		if(gm->map && starts[i]) {
			usr->state.x = starts[i]->x1;
			usr->state.y = starts[i]->y1;
			usr->state.angle = starts[i]->x2;
			tries = 1;
		}

		if(!tries) {
			do {
				usr->state.x = borderwidth + rand() % (gm->w - 2 * borderwidth);
				usr->state.y =  borderheight + rand() % (gm->h - 2 * borderheight);
				usr->state.angle = rand() % 628 / 100.0;
				seg.x1 = usr->state.x;
				seg.y1 = usr->state.y;
				seg.x2 = cos(usr->state.angle) * diameter + usr->state.x;
				seg.y2 = sin(usr->state.angle) * diameter + usr->state.y;
			} while(gm->map && checkcollision(gm, &seg) != -1.0 && tries++ < MAX_PLAYERSTART_TRIES);
		}

		/* hstart now between 1 and 2 times usr->hsize + usr->hfreq */
		usr->hstart = (1 + rand() % 5000/ 2500.0) * (usr->hsize + usr->hfreq);
		i++;
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
	char buf[20];

	jsonaddnum(json, "id", gm->id);
	jsonaddnum(json, "n", gm->n);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	if(gm->host)
		jsonaddstr(json, "host", gm->host->name);

	jsonaddstr(json, "type", gametypetostr(gm->type, buf));
	jsonaddstr(json, "state", statetostr(gm->state, buf));
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
	cJSON *games = encodegamelist();

	if(gamelist)
		free(gamelist);

	gamelist = jsonprint(games);
	gamelistlen = strlen(gamelist);
	jsondel(games);
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
		struct teleport *t;
		for(seg = gm->map->seg; seg; seg = seg->nxt)
			addsegment(gm, seg);
		
		for(t = gm->map->teleports; t; t = t->nxt)
			addsegment(gm, &t->seg);
	}
		
	/* reset users */
	for(usr = gm->usr; usr; usr = usr->nxt){
		usr->state.turn = 0;
		usr->state.alive = 1;
		usr->state.tick = 0;
		usr->deltaon = usr->deltaat = 0;
		usr->state.v = gm->v;
		usr->state.ts = gm->ts;
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
		cJSON_AddNumberToObject(player, "startX", usr->state.x);
		cJSON_AddNumberToObject(player, "startY", usr->state.y);
		cJSON_AddNumberToObject(player, "startAngle", usr->state.angle);
		cJSON_AddNumberToObject(player, "holeStart", usr->hstart);
		cJSON_AddItemToArray(start_locations, player);
	}

	/* spreading the word to all in the game */
	jsonaddnum(root, "startTime", (int)gm->start);
	jsonaddnum(root, "goal", gm->goal);
	cJSON_AddItemToObject(root, "startPositions", start_locations);
	sendjsontogame(root, gm, 0);
	jsondel(root);
}

struct teleport *createteleport(struct seg *seg, struct seg *dest, int id) {
	struct teleport *t;
	
	t = smalloc(sizeof(struct teleport));
	t->colorid = id;
	t->seg = *seg;
	t->seg.t = t;
	t->dx = (dest->x2 - dest->x1) / getseglength(seg);
	t->dy = (dest->y2 - dest->y1) / getseglength(seg);
	t->dest = *dest;
	t->anglediff = getsegangle(dest) - getsegangle(seg);
	return t;
}

struct map *createmap(cJSON *j) {
	struct map *map = scalloc(1, sizeof(struct map));
	struct seg taken, *telbuffer[MAX_TELEPORTS];
	int i;

	for(i = 0; i < MAX_TELEPORTS; i++)
		telbuffer[i] = 0;

	while(j) {
		struct seg *seg = scalloc(1, sizeof(struct seg));
		seg->x1 = jsongetint(j, "x1");
		seg->y1 = jsongetint(j, "y1");
		seg->x2 = jsongetint(j, "x2");
		seg->y2 = jsongetint(j, "y2");

		if(jsoncheckjson(j, "playerStart")) {

			seg->x2 = jsongetfloat(j, "angle");
			seg->nxt = map->playerstarts;
			map->playerstarts = seg;

		} else {

			if(!seginside(seg, MAX_GAME_WIDTH, MAX_GAME_HEIGHT)) {
				warning("some host made custom map with segments outside max boundaries\n");
				free(seg);
				j = j->next;
				continue;
			}

			if(jsoncheckjson(j, "teleportId")) {
				int id;
				
				id = jsongetint(j, "teleportId");
				if(id < 0 || id >= MAX_TELEPORTS) {
					warning("createmap teleport error 1\n");
					free(seg);
					j = j->next;
					continue;
				}

				if(!telbuffer[id]) {
					telbuffer[id] = seg;
				} else if(telbuffer[id] == &taken) {
					warning("createmap teleport error 2\n");
					free(seg);
					j = j->next;
					continue;
				} else {
					struct teleport *tela, *telb;

					tela = createteleport(seg, telbuffer[id], id);
					telb = createteleport(telbuffer[id], seg, id);
					
					tela->nxt = telb;
					telb->nxt = map->teleports;
					map->teleports = tela;

					free(seg);
					free(telbuffer[id]);

					telbuffer[id] = &taken;
				}

			} else {
				seg->nxt = map->seg;
				map->seg = seg;
			}
		}

		j = j->next;
	}

	for(i = 0; i < MAX_TELEPORTS; i++)
		if(telbuffer[i] && telbuffer[i] != &taken)
			free(telbuffer[i]);

	return map;
}

void freemap(struct map *map) {
	freesegments(map->seg);
	freesegments(map->playerstarts);
	free(map);
}

void remgame(struct game *gm) {
	struct user *usr, *nxt;
	int i, num_tiles = gm->htiles * gm->vtiles;
	
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

		if(usr->inputmechanism == inputmechanism_human)
			joingame(lobby, usr);
		else
			deleteuser(usr);
	}

	/* freeing up segments */
	for(i = 0; i < num_tiles; i++)
		freesegments(gm->seg[i]);

	if(gm->map)
		freemap(gm->map);
	free(gm->seg);
	freekicklist(gm->kicklist);
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

struct user *findplayer(struct game *gm, int id) {
	struct user *waldo;
	for(waldo = gm->usr; waldo && waldo->id != id; waldo = waldo->nxt);
	return waldo;
}

/* takes game id and returns pointer to game */
struct game *searchgame(int gameid) {
	struct game *gm;

	for(gm = headgame; gm && gameid != gm->id; gm = gm->nxt);

	return gm;
}

void broadcasthost(struct game *gm) {
	cJSON *j = jsoncreate("setHost");
	jsonaddnum(j, "playerId", gm->host->id);
	sendjsontogame(j, gm, 0);
	jsondel(j);
}

void tellhost(struct user *host, struct user *usr) {
	cJSON *j = jsoncreate("setHost");
	jsonaddnum(j, "playerId", host->id);
	sendjson(j, usr);
	jsondel(j);
}

void leavegame(struct user *usr, int reason) {
	struct game *gm = usr->gm;
	struct user *curr;
	char buf[20];
	cJSON *json;

	if(DEBUG_MODE && gm->type != GT_LOBBY)
		printf("user %d is leaving his game!\n", usr->id);

	if(gm->state == GS_STARTED && usr->state.alive) {
		usr->state.alive = 0;
		handledeath(usr);
	}
	
	if(gm->state == GS_STARTED)
		logplayer(usr, "ragequit\n");

	/* remove user from linked list */
	if(gm->usr == usr)
		gm->usr = usr->nxt;
	else {
		for(curr = gm->usr; curr->nxt && curr->nxt != usr; curr = curr->nxt);
		curr->nxt = usr->nxt;
	}

	/* check if there still human players in list */
	for(curr = gm->usr; curr && curr->inputmechanism != inputmechanism_human; curr = curr->nxt);

	if(curr && gm->host == usr) {
		gm->host = curr;
		broadcasthost(gm);
		gamelistcurrent = 0;
	}

	gm->n--;
	usr->nxt = 0;
	usr->gm = 0;

	/* send message to group: this player left */
	json = jsoncreate("playerLeft");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddstr(json, "reason", leavereasontostr(reason, buf));
	sendjsontogame(json, gm, 0);
	jsondel(json);

	if(gm->type != GT_LOBBY) {
		if(gm->state != GS_REMOVING_GAME && !curr)
			remgame(gm);
		else if(gm->state == GS_STARTED && gm->n == 1)
			endround(gm);
	}

	if(DEBUG_MODE) printgames();
}

void joingame(struct game *gm, struct user *newusr) {
	struct user *usr;
	char buf[20];
	cJSON *json;

	if(newusr->gm)
		leavegame(newusr, LEAVE_NORMAL);

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
	if(gm->type == GT_CUSTOM && !gm->host)
		gm->host = newusr;

	/* tell user s/he joined a game */
	json = jsoncreate("joinedGame");
	jsonaddstr(json, "type", gametypetostr(gm->type, buf));
	jsonaddnum(json, "index", newusr->index);
	sendjson(json, newusr);
	jsondel(json);

	/* tell players of game someone new joined and send a message to the new
	 * player for every other player that is already in the game */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		json = jsoncreate("newPlayer");
		jsonaddnum(json, "playerId", usr->id);
		jsonaddnum(json, "index", usr->index);
		jsonaddstr(json, "playerName", usr->name);
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
		if(gm->host)
			tellhost(gm->host, newusr);
	}

	if(gm->type == GT_AUTO && gm->n >= gm->nmin)
		startgame(gm);

	/* tell everyone in lobby of new game */
	if(gm->n == 1) {
		json = encodegame(gm);
		cJSON_AddStringToObject(json, "mode", "newGame");
		sendjsontogame(json, lobby, newusr);
		jsondel(json);
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
	gm->nmin = nmin;
	gm->nmax = nmax;
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

/* returns -1 if no collision, between 0 and 1 other wise */
float segcollision(struct seg *seg1, struct seg *seg2) {
	float denom, numer_a, numer_b, a, b;
	
	if(seg1->x2 == seg2->x1 && seg1->y2 == seg2->y1)
		return -1;

	denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	/* segments are parallel */
	if(fabs(denom) < EPS)
		return -1;

	numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	a = numer_a/ denom;

	if(a < 0 || a > 1)
		return -1;

	numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);
	b = numer_b/ denom;

	return (b >= 0 && b <= 1) ? b : -1;
}

/* variant of segcollision which might be faster. XPERIMENTAL: needs benchmark */
float fastcollision(struct seg *seg1, struct seg *seg2) {
	float denom, numer_a, numer_b, seg1dx, seg1dy, seg2dx, seg2dy, dx1, dy1;
	
	if(seg1->x2 == seg2->x1 && seg1->y2 == seg2->y1)
		return -1;

	seg1dx = seg1->x1 - seg1->x2;
	seg1dy = seg1->y1 - seg1->y2;
	seg2dx = seg2->x1 - seg2->x2;
	seg2dy = seg2->y1 - seg2->y2;
	denom = seg1dx * seg2dy - seg1dy * seg2dx;

	/* segments are parallel */
	if(fabs(denom) < EPS)
		return -1;

	dx1 = seg1->x1 - seg2->x1;
	dy1 = seg1->y1 - seg2->y1;
	numer_a = seg2dy * dx1 - seg2dx * dy1;

	if(denom >= 0 ? (numer_a < 0 || numer_a > denom) : (numer_a > 0 || numer_a < denom))
		return -1;

	numer_b = seg1dy * dx1 - seg1dx * dy1;

	return (denom >= 0 ? (numer_b < 0 || numer_b > denom) : (numer_b > 0 || numer_b < denom)) ? -1 : numer_b/ denom;
}

/* returns -1 in case no collision, else between 0 and -1 */
float checktilecollision(struct seg *tile, struct seg *seg, struct seg **collidingseg) {
	struct seg *current;
	float cut, mincut = -1;

	for(current = tile; current; current = current->nxt) {
		cut = segcollision(current, seg);

		if(cut != -1.0) {
			if(mincut == -1.0 || cut < mincut) {
				mincut = cut;
				*collidingseg = current;
			}

			if(ULTRA_VERBOSE) {
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

	tileindices[3] = ((int) seg->x1)/ gm->tilew;
	tileindices[1] = ((int) seg->x2)/ gm->tilew;
	if(tileindices[3] > tileindices[1]) {
		swap = tileindices[3];
		tileindices[3] = tileindices[1];
		tileindices[1] = swap;
	}

	tileindices[2] = ((int) seg->y1)/ gm->tileh;
	tileindices[0] = ((int) seg->y2)/ gm->tileh;
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

struct seg *collidingseg = 0; // maybe instead as parameter to checkcollision

/* returns -1 in case of no collision, between 0 and 1 else */
float checkcollision(struct game *gm, struct seg *seg) {
	int i, j, tileindices[4], index, dx;
	float cut, mincut = -1;
	struct seg *collider = 0;

	tiles(gm, seg, tileindices);
	index = gm->htiles * tileindices[0] + tileindices[3];
	dx = gm->htiles + tileindices[3] - tileindices[1] - 1;

	for(j = tileindices[0]; j <= tileindices[2]; j++, index += dx) {
		for(i = tileindices[3]; i <= tileindices[1]; i++, index++) {
			cut = checktilecollision(gm->seg[index], seg, &collider);

			if(cut != -1.0 && (mincut == -1.0 || cut < mincut)) {
				mincut = cut;
				collidingseg = collider;
			}
		}
	}

	return mincut;
}

/* adds segment to the game. does not check for collision */
void addsegment(struct game *gm, struct seg *seg) {
	int i, j, tileindices[4], index, dx;
	struct seg *copy;

	tiles(gm, seg, tileindices);
	index = gm->htiles * tileindices[0] + tileindices[3];
	dx = gm->htiles + tileindices[3] - tileindices[1] - 1;

	for(j = tileindices[0]; j <= tileindices[2]; j++, index += dx) {
		for(i = tileindices[3]; i <= tileindices[1]; i++, index++) {
			copy = copyseg(seg);
			copy->nxt = gm->seg[index];
			gm->seg[index] = copy;
		}
	}
}

/* queues player segment to send for debugging */
void queueseg(struct game *gm, struct seg *seg) {
	struct seg *copy = copyseg(seg);
	copy->nxt = gm->tosend;
	gm->tosend = copy;
}

void simuser(struct userpos *state, struct user *usr, char addsegments) {
	float cut;
	double oldx = state->x, oldy = state->y, oldangle = state->angle;
	int inhole, outside;
	struct seg seg;
	char handled = 0;

	state->angle += state->turn * state->ts * TICK_LENGTH / 1000.0;
	state->x += cos(state->angle) * state->v * TICK_LENGTH / 1000.0;
	state->y += sin(state->angle) * state->v * TICK_LENGTH / 1000.0;
	
	inhole = state->tick > usr->hstart 
	 && (state->tick + usr->hstart) % (usr->hsize + usr->hfreq) < usr->hsize;
	outside = state->x < 0 || state->x > usr->gm->w
	 || state->y < 0 || state->y > usr->gm->h;

	/* check for collisions and add segment to map if needed */
	seg.t = 0;
	seg.x1 = oldx;
	seg.y1 = oldy;
	seg.x2 = state->x;
	seg.y2 = state->y;
		
	cut = checkcollision(usr->gm, &seg);
	if(cut != -1.0) {
		if(collidingseg->t) {
			struct teleport *t = collidingseg->t;
			double x = (1 - cut) * seg.x1 + cut * seg.x2;
			double y = (1 - cut) * seg.y1 + cut * seg.y2;
			double r = getlength(x - collidingseg->x1, y - collidingseg->y1);
			
			/* we make sure to not cross the teleport */
			seg.x2 = x - cos(state->angle) / 10;
			seg.y2 = y - sin(state->angle) / 10;

			state->angle += t->anglediff;
			state->x = t->dest.x1 + t->dx * r + cos(state->angle) / 2;
			state->y = t->dest.y1 + t->dy * r + sin(state->angle) / 2;
			handled = 1; 
		} else if(!inhole || !HACKS) {
			state->x = seg.x2 = (1 - cut) * seg.x1 + cut * seg.x2;
			state->y = seg.y2 = (1 - cut) * seg.y1 + cut * seg.y2;
			state->alive = 0;
			handled = 1;
		}
	}
	if(addsegments && !inhole) {
		addsegment(usr->gm, &seg);
			
		if(SEND_SEGMENTS)
			queueseg(usr->gm, &seg);
	}

	if(!handled && outside) {

		if(usr->gm->torus) {

			if(state->x > usr->gm->w)
				state->x = oldx - usr->gm->w;
			else if(state->x < 0)
				state->x = oldx + usr->gm->w;
			else
				state->x = oldx;

			if(state->y > usr->gm->h)
				state->y = oldy - usr->gm->h;
			else if(state->y < 0)
				state->y = oldy + usr->gm->h;
			else
				state->y = oldy;
			
			/* simulate this tick again from another point */
			state->angle = oldangle;
			simuser(state, usr, addsegments);
			return;

		} else {
		
			state->alive = 0;

		}
	}
	
	state->tick++;
}

/* send message to group: this player died */
void deadplayermsg(struct user *usr, int tick, int reward) {
	cJSON *json = jsoncreate("playerDied");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddnum(json, "reward", reward);
	jsonaddnum(json, "tick", tick);
	jsonaddnum(json, "x", usr->state.x);
	jsonaddnum(json, "y", usr->state.y);
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

	for(roundwinner = gm->usr; roundwinner && !roundwinner->state.alive;
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

void handledeath(struct user *victim) {
	struct game *gm = victim->gm;
	struct user *usr;
	int reward = gm->pointsys(gm->rsn, --gm->alive);
	
	if(gm->pencilmode == PM_ONDEATH) {
		victim->pencil.tick = gm->tick;
	}

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr->state.alive)
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

	for(usr = gm->usr; usr; usr = usr->nxt) {
		if(gm->pencilmode != PM_OFF)
			simpencil(&usr->pencil);

		if(usr->state.alive) {
			usr->inputmechanism(usr, gm->tick);
			
			if(usr->inputhead && usr->inputhead->tick == gm->tick) {
				struct userinput *input = usr->inputhead;
				usr->state.turn = input->turn;
				usr->inputhead = input->nxt;
				free(input);
				if(!usr->inputhead)
					usr->inputtail = 0;
			}
			
			simuser(&usr->state, usr, 1);
			if(!usr->state.alive) {
				if(GOD_MODE)
					usr->state.alive = 1;
				else
					handledeath(usr);
			}
		}
	}

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
	long now;
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
		now = servermsecs();

		if(sleepuntil < now - 3 * TICK_LENGTH && now - lastheavyloadmsg > 100) {
			warning("%ld msec behind on schedule!\n", now - sleepuntil);
			lastheavyloadmsg = now;
		}

		do { libwebsocket_service(ctx, max(0, sleepuntil - now)); }
		while(sleepuntil - (now = servermsecs()) > 0);
	}
}

void queueinput(struct user *usr, int tick, int turn) {
	struct userinput *input = smalloc(sizeof(struct userinput));
	input->tick = tick;
	input->turn = turn;
	input->nxt = 0;
	
	if(!usr->inputtail)
		usr->inputhead = usr->inputtail = input;
	else
		usr->inputtail = usr->inputtail->nxt = input;
}

void interpretinput(cJSON *json, struct user *usr) {
	int turn = jsongetint(json, "turn");
	int tick = jsongetint(json, "tick");
	long now = servermsecs();
	int delay, msgtick = tick;
	int time = tick * TICK_LENGTH + TICK_LENGTH/ 2;
	cJSON *j;
	
	/* some checks */
	if(turn < -1 || turn > 1 || turn == usr->lastinputturn) {
		if(SHOW_WARNING)
			printf("invalid user input received from user %d.\n", usr->id);
		return;
	}
	if(!usr->state.alive) {
		if(SHOW_WARNING)
			printf("received input for dead user %d? ignoring..\n", usr->id);
		return;
	}

	if(tick < usr->gm->tick) {
		if(SHOW_WARNING)
			printf("received msg from user %d of %d msec old! tick incremented by %d\n",
			 usr->id, (int) (now - usr->gm->start - time), usr->gm->tick - tick);
		tick = usr->gm->tick;
	}
	if(tick <= usr->lastinputtick)
		tick = usr->lastinputtick + 1;
	delay = tick - msgtick;

	if(delay)
		usr->gm->modifieds++;
	
	queueinput(usr, tick, turn);	
	
	if(SHOW_DELAY) {
		int x = (now - usr->gm->start) - time;
		printf("delay: %d\n", x);
	}
	
	/* check if user needs to adjust her gametime */
	usr->delta[usr->deltaat++] = (now - usr->gm->start) - time;
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
	usr->inputmechanism = inputmechanism_human;
}

void deleteuser(struct user *usr) {
	int i;
	
	if(usr->gm)
		leavegame(usr, LEAVE_DISCONNECT);

	clearinputs(usr);
	cleanpencil(&(usr->pencil));

	if(usr->name)
		free(usr->name);
	
	for(i = 0; i < usr->sbat; i++)
		free(usr->sb[i]);

	if(usr->recvbuf)
		free(usr->recvbuf);

	if(usr->inputmechanism != inputmechanism_human)
		free(usr);
}

void freekicklist(struct kicknode *kick) {
	struct kicknode *nxt;

	while(kick) {
		nxt = kick->nxt;
		free(kick);
		kick = nxt;
	}
}

/* returns non-zero iff usr was kicked and the ban has not yet expired -- also
 * removes all expired entries from the game's kicklist. note that this relies
 * on the fact that list is decreasing in expiration */
int checkkick(struct game *gm, struct user *usr) {
	struct kicknode *prev = 0, *kick;
	long now = servermsecs();

	for(kick = gm->kicklist; kick; kick = kick->nxt) {
		if(now >= kick->expiration) {
			if(prev)
				prev->nxt = 0;
			else
				gm->kicklist = 0;

			freekicklist(kick);
			return 0;
		}

		if(kick->usr == usr)
			return kick->expiration - now;

		prev = kick;
	}

	return 0;
}

void addcomputer(struct game *gm) {
	struct user *comp = smalloc(sizeof(struct user));
	iniuser(comp, 0);
	comp->name = smalloc(MAX_NAME_LENGTH + 1);
	strcpy(comp->name, COMPUTER_NAME);
	comp->inputmechanism = COMPUTER_AI;
	joingame(gm, comp);
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
		x = json->valueint;
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

/* inputmechanisms determine how users are controlled. in particular whether they
 * are player or computer controlled. returns turn for current tick */
void inputmechanism_human(struct user *usr, int tick) {;}

void inputmechanism_circling(struct user *usr, int tick) {
	int turn = tick > 5 && !(tick % 5);
	tick += COMPUTER_DELAY;

	if(turn == usr->lastinputturn)
		return;

	queueinput(usr, tick, turn);
	steermsg(usr, tick, turn, 0);
}

void inputmechanism_random(struct user *usr, int tick) {
	int turn;

	if(tick % 10)
		return;

	turn = rand() % 3 - 1;
	tick += COMPUTER_DELAY;

	if(turn == usr->lastinputturn)
		return;

	queueinput(usr, tick, turn);
	steermsg(usr, tick, turn, 0);
}

void inputmechanism_leftisallineed(struct user *usr, int tick) {
	int turn, i;
	struct seg seg;
	float visionlength;
	struct userpos *pos = &usr->aistate;

	if(tick == 0) {
		memcpy(pos, &usr->state, sizeof(struct userpos));

		for(i = 0; i < COMPUTER_DELAY; i++)
			simuser(pos, usr, 0);
	}
	
	visionlength = pos->ts != 0 ? 3.14 / pos->ts * pos->v : 9999;

	seg.t = 0;
	seg.x1 = pos->x;
	seg.y1 = pos->y;
	seg.x2 = seg.x1 + cos(pos->angle) * visionlength;
	seg.y2 = seg.y1 + sin(pos->angle) * visionlength;
	turn = -1 * (checkcollision(usr->gm, &seg) != -1.0);
	
	pos->turn = turn;
	simuser(pos, usr, 0);

	if(turn == usr->lastinputturn)
		return;

	queueinput(usr, tick, turn);
	steermsg(usr, tick, turn, 0);
}

float marcusai_helper(struct userpos *state, struct user *usr, int depth, int tickstep) {
	struct seg megaseg;
	struct userpos newstate;
	int turn, i;
	float best = 0;

	/* check how far we can go by just going straight ahead */
	if(depth == 0) {
		megaseg.x1 = state->x;
		megaseg.y1 = state->y;
		megaseg.x2 = state->x + state->v * COMPUTER_SEARCH_CAREFULNESS * cos(state->angle);
		megaseg.y2 = state->y + state->v * COMPUTER_SEARCH_CAREFULNESS * sin(state->angle);
		return fabs(checkcollision(usr->gm, &megaseg));
	}

	/* simulate a bit ahead */
	memcpy(&newstate, state, sizeof(struct userpos));

	for(i = 0; i < tickstep; i++) {
		simuser(&newstate, usr, 0);

		if(!newstate.alive)
			return ((float) i)/ tickstep;
	}

	/* check what path has best future */
	for(turn = -1; turn <= 1; turn++) {
		newstate.turn = turn;
		best = max(best, marcusai_helper(&newstate, usr, depth - 1, tickstep));
	}

	return 1 + best;
}

void inputmechanism_marcusai(struct user *usr, int tick) {
	int i, j, turn = 0, totalticks, tickstep;
	float best = 0, current;
	struct userpos *pos = &usr->aistate;

	if(0 == tick) {
		memcpy(pos, &usr->state, sizeof(struct userpos));

		for(i = 0; i < COMPUTER_DELAY; i++)
			simuser(pos, usr, 0);
	}

	totalticks = ceil(COMPUTER_SEARCH_ANGLE * 1000.0/ pos->ts/ TICK_LENGTH);
	tickstep = totalticks/ COMPUTER_SEARCH_DEPTH +
	 !!(totalticks % COMPUTER_SEARCH_DEPTH);

	for(i = 1; i <= 3; i++) {
		j = (i % 3) - 1;
		pos->turn = j;

		if((current = marcusai_helper(pos, usr, COMPUTER_SEARCH_DEPTH, tickstep)) > best) {
			best = current;
			turn = j;
		}
	}

	pos->turn = turn;
	simuser(pos, usr, 0);

	if(turn == usr->lastinputturn)
		return;

	tick += COMPUTER_DELAY;
	queueinput(usr, tick, turn);
	steermsg(usr, tick, turn, 0);
}

void inputmechanism_checktangent(struct user *usr, int tick) {
	int turn;
	struct seg seg;
	float visionlength;
	struct userpos *pos = &usr->aistate;

	if(tick == 0) {
		memcpy(pos, &usr->state, sizeof(struct userpos));
	}
	
	visionlength = pos->ts != 0 ? 3.14 / pos->ts * pos->v : 9999;

	seg.x1 = pos->x;
	seg.y1 = pos->y;
	seg.x2 = seg.x1 + cos(pos->angle) * visionlength;
	seg.y2 = seg.y1 + sin(pos->angle) * visionlength;
	turn = checkcollision(usr->gm, &seg) != -1.0;
	if(turn) {
		double x, y, a, b;
	
		x = cos(pos->angle);
		y = sin(pos->angle);
		a = collidingseg->x1 - collidingseg->x2;
		b = collidingseg->y1 - collidingseg->y2;
		if(x * a + y * b < 0) {
			a = -a;
			b = -b;
		}
		turn = x * b - y * a > 0 ? 1 : -1;
	}
	pos->turn = turn;
	simuser(pos, usr, 0);

	if(turn == usr->lastinputturn)
		return;

	queueinput(usr, tick, turn);
	steermsg(usr, tick, turn, 0);
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
