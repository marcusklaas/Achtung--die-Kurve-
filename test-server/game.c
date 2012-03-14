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

		/* to make sure client receives same values */
		usr->state.angle = (int) (usr->state.angle * 1000) / 1000.0; 
		usr->state.x = (int) usr->state.x;
		usr->state.y = (int) usr->state.y; 

		i++;
	}
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

void addmapsegments(struct game *gm) {
	struct seg *seg;
	struct teleport *t;
		
	for(seg = gm->map->seg; seg; seg = seg->nxt) {
		addsegment(gm, seg);
		if(gm->aigame)
			addsegmentfull(gm, seg, 1, 0, -1, 0);
	}
		
	for(t = gm->map->teleports; t; t = t->nxt) {
		addsegment(gm, &t->seg);
		if(gm->aigame)
			addsegmentfull(gm, &t->seg, 1, 0, -1, 0);
	}
}

void startround(struct game *gm) {
	struct user *usr;
	cJSON *root, *start_locations;
	int laterround = gm->round++ != 0;
	
	gm->aigame = 0;
	
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
		usr->dietick = INT_MAX;

		if(gm->pencilmode != PM_OFF)
			resetpencil(&usr->pencil, usr);
			
		if(!usr->human)
			gm->aigame = 1;
	}

	if(gm->aigame)
		createaimap(gm);
	if(gm->map)
		addmapsegments(gm);
	
	gm->rsn = gm->n;
	randomizeplayerstarts(gm);
	
	if(gm->aigame) {
		for(usr = gm->usr; usr; usr = usr->nxt)
			usr->aimapstate = usr->state;
	}

	gm->start = serverticks * TICK_LENGTH + laterround * COOLDOWN + COUNTDOWN;
	gm->tick = -(COUNTDOWN + SERVER_DELAY + laterround * COOLDOWN)/ TICK_LENGTH;
	gm->state = GS_STARTED;
	gm->alive = gm->n;
	gm->modifieds = 0;
	gm->timeadjustments = 0;

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
	airjson(root, gm, 0);
	jsondel(root);
}

void startgame(struct game *gm) {
	double seglen = gm->v * TICK_LENGTH / 1000.0;

	if(DEBUG_MODE)
		printf("starting game %p!\n", (void*)gm);
	
	gm->tilew = gm->tileh = ceil(TILE_SIZE_MULTIPLIER * seglen);
	gm->htiles = ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles = ceil(1.0 * gm->h / gm->tileh);
	gm->seg = scalloc(gm->htiles * gm->vtiles, sizeof(struct seg*));
	
	startround(gm);
	gamelistcurrent = 0;
	logstartgame(gm);
}

struct teleport *createteleport(struct seg *seg, struct seg *dest, int id) {
	struct teleport *t;
	double w, h;
	
	t = smalloc(sizeof(struct teleport));
	t->colorid = id;
	t->seg = *seg;
	t->seg.t = t;
	w = seg->x2 - seg->x1;
	h = seg->y2 - seg->y1;
	t->tall = fabs(h) > fabs(w);
	t->dx = (dest->x2 - dest->x1) / (t->tall ? h : w);
	t->dy = (dest->y2 - dest->y1) / (t->tall ? h : w);
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

			seg->x2 = jsongetdouble(j, "angle");
			seg->nxt = map->playerstarts;
			map->playerstarts = seg;

		} else {

			if(!seginside(seg, MAX_GAME_WIDTH, MAX_GAME_HEIGHT) || 
					(seg->x1 == seg->x2 && seg->y1 == seg->y2)) {
				warning("createmap segment out of boundaries or zero-length error\n");
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
	freeteleports(map->teleports);
	free(map);
}

void userclearstartround(struct user *usr) {
	if(usr->aidata) {
		freemapaidata(usr->aidata);
		free(usr->aidata);
		usr->aidata = 0;
	}
	usr->branch = 0;
}

void clearstartround(struct game *gm) {
	int i, num_tiles = gm->htiles * gm->vtiles;
	struct user *usr;
	
	if(gm->seg) {
		for(i = 0; i < num_tiles; i++) {
			freesegments(gm->seg[i]);
			gm->seg[i] = 0;
		}
	}
	
	if(gm->aimap)
		freeaimap(gm);
	
	if(gm->branch) {
		free(gm->branch);
		gm->branch = 0;
	}
	
	for(usr = gm->usr; usr; usr = usr->nxt)
		userclearstartround(usr);
}

void clearstartgame(struct game *gm) {
	if(gm->seg) {
		free(gm->seg);
		gm->seg = 0;
	}

	freesegments(gm->tosend);
	gm->tosend = 0;
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

		if(usr->human)
			joingame(lobby, usr);
		else
			deleteuser(usr);
	}


	if(gm->map)
		freemap(gm->map);

	clearstartround(gm);
	clearstartgame(gm);
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
		json = encodegamepars(gm);
		airjson(json, gm, 0);
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
	for(curr = gm->usr; curr && !curr->human; curr = curr->nxt);

	if(curr && gm->host == usr) {
		gm->host = curr;
		airhost(gm);
		gamelistcurrent = 0;
	}

	gm->n--;
	usr->nxt = 0;
	usr->gm = 0;
	
	userclearstartround(usr);

	/* send message to group: this player left */
	json = jsoncreate("playerLeft");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddstr(json, "reason", leavereasontostr(reason, buf));
	airjson(json, gm, 0);
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
			airjson(json, gm, newusr);
		else
			sendjson(json, newusr);
		jsondel(json);
	}
	
	/* send either game details or game list */
	if(gm->type == GT_LOBBY)
		sendgamelist(newusr);
	else {
		json = encodegamepars(gm);
		sendjson(json, newusr);
		jsondel(json);
		
		if(gm->map)
			sendmap(gm->map, newusr);
		if(gm->host)
			sendhost(gm->host, newusr);
	}

	if(gm->type == GT_AUTO && gm->n >= gm->nmin)
		startgame(gm);

	/* tell everyone in lobby of new game */
	if(gm->n == 1) {
		json = encodegame(gm);
		cJSON_AddStringToObject(json, "mode", "newGame");
		airjson(json, lobby, newusr);
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

	return gm;
}

/* returns -1 if no collision, between 0 and 1 other wise */
double segcollision(struct seg *seg1, struct seg *seg2) {
	double denom, numer_a, numer_b, a, b;
	
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

/* returns -1 in case no collision, else between 0 and -1 */
double checktilecollision(struct seg *tile, struct seg *seg, struct seg **collidingseg) {
	struct seg *current;
	double cut, mincut = -1;

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

struct user *no_collision_usr;
int no_collision_tick;

/* returns -1 in case no collision, else between 0 and -1 */
double checkaitilecollision(struct game *gm, struct aitile *tile, struct seg *seg, int tick, char solid, char setdietick, struct aiseg **collidingseg) {
	struct aiseg *current, *end;
	double cut, mincut = -1;
	
	for(current = tile->seg, end = tile->seg + tile->len; current < end; current++) {

		if(!solid && !current->seg.t)
			continue;
		
		if(no_collision_usr && no_collision_usr == current->usr && current->tick >= no_collision_tick)
			continue;
			
		if(current->branch) {
		
			if(current->tick >= gm->branch[current->branch].tick){
			
				/* remove segment */
				tile->len--;
				end--;
				if(current < end) {
					*current = *end;
					current--;
				}
				
				continue;
			}
			
			if(gm->branch[current->branch].closed)
				current->branch = 0;
		}
		
		cut = segcollision(&current->seg, seg);

		if(cut != -1.0) {
				
			if(current->tick > tick && setdietick && current->usr) {
				if(current->tick < current->usr->dietick) {
					current->usr->dieseg = current->seg;
					current->usr->dietick = current->tick;
				}
				continue;
			}
			
			if(mincut == -1.0 || cut < mincut) {
				mincut = cut;
				*collidingseg = current;
			}
		}
	}

	return mincut;
}

/* returns 1 in case the segment intersects the box */
int lineboxcollision(struct seg *seg, int top, int right, int bottom, int left) {
	struct seg edge;

	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 < right && seg->y1 < bottom && seg->y1 >= top)
		return 1;

	if(seg->x2 >= left && seg->x2 < right && seg->y2 < bottom && seg->y2 >= top)
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

void gettiles(struct game *gm, struct seg *seg, int *pa, int *pb, int *pc, int *pd) {
	int a, b, c, d;

	a = ((int) seg->x1)/ gm->tilew;
	b = ((int) seg->x2)/ gm->tilew;
	d = ((int) seg->y1)/ gm->tileh;
	c = ((int) seg->y2)/ gm->tileh;

	*pa = max(min(a, b), 0);
	*pb = min(max(a, b), gm->htiles - 1);
	*pc = max(min(c, d), 0);
	*pd = min(max(c, d), gm->vtiles - 1);
}

struct seg dieseg, *collidingseg = 0; // maybe instead as parameter to checkcollision
struct aiseg *collidingaiseg = 0;

/* returns -1 in case of no collision, between 0 and 1 else */
double checkcollision(struct game *gm, struct seg *seg) {
	int i, j, a, b, c, d, index, dx;
	double cut, mincut = -1;
	struct seg *collider = 0;

	gettiles(gm, seg, &a, &b, &c, &d);
	index = gm->htiles * c + a;
	dx = gm->htiles + a - b - 1;

	for(j = c; j <= d; j++, index += dx) {
		for(i = a; i <= b; i++, index++) {
			cut = checktilecollision(gm->seg[index], seg, &collider);

			if(cut != -1.0 && (mincut == -1.0 || cut < mincut)) {
				mincut = cut;
				collidingseg = collider;
			}
		}
	}

	return mincut;
}

/* returns -1 in case of no collision, between 0 and 1 else */
double checkaimapcollision(struct user *usr, struct seg *seg, int tick, char solid, char setdietick) {
	int i, j, a, b, c, d, index, dx;
	double cut, mincut = -1;
	struct aiseg *collider = 0;
	
	gettiles(usr->gm, seg, &a, &b, &c, &d);
	index = usr->gm->htiles * c + a;
	dx = usr->gm->htiles + a - b - 1;

	for(j = c; j <= d; j++, index += dx) {
		for(i = a; i <= b; i++, index++) {
			cut = checkaitilecollision(usr->gm, usr->gm->aimap->tile + index, seg, tick, solid, setdietick, &collider);

			if(cut != -1.0 && (mincut == -1.0 || cut < mincut)) {
				mincut = cut;
				collidingaiseg = collider;
				collidingseg = &collider->seg;
			}
		}
	}

	return mincut;
}

void addsegment(struct game *gm, struct seg *seg) {
	addsegmentfull(gm, seg, 0, 0, 0, 0);
}

void addsegmentfull(struct game *gm, struct seg *seg, char aimap, struct user *usr, int tick, int branch) {
	int i, j, a, b, c, d, index, dx;
	struct seg *copy;
	
	gettiles(gm, seg, &a, &b, &c, &d);
	index = gm->htiles * c + a;
	dx = gm->htiles + a - b - 1;

	for(j = c; j <= d; j++, index += dx) {
		for(i = a; i <= b; i++, index++) {
			if(!lineboxcollision(seg, j * gm->tileh, (i + 1) * gm->tilew,
				(j + 1) * gm->tileh, i * gm->tilew))
				continue;

			if(aimap) {
				struct aiseg aiseg;
				struct aitile *tile = gm->aimap->tile + index;
				
				aiseg.seg = *seg;
				aiseg.usr = usr;
				aiseg.tick = tick;
				aiseg.branch = branch;
				
				if(!tile->seg) {
					tile->cap = AIMAP_STARTCAP;
					tile->seg = smalloc(sizeof(struct aiseg) * tile->cap);
				} else if(tile->cap == tile->len) {
					tile->cap *= 2;
					tile->seg = srealloc(tile->seg, sizeof(struct aiseg) * tile->cap);
				}
				tile->seg[tile->len++] = aiseg;
				
			} else {
				copy = copyseg(seg);
				copy->nxt = gm->seg[index];
				gm->seg[index] = copy;
			}
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
	simuserfull(state, usr, addsegments, 0, 0, 0);
}

void simuserfull(struct userpos *state, struct user *usr, char addsegments, char aimap, char solid, int branch) {
	double cut;
	int inhole, outside;
	struct seg seg;
	char handled = 0;
	
	if(!state->alive)
		return;
	
	seg.t = 0;
	seg.x1 = state->x;
	seg.y1 = state->y;

	state->angle += state->turn * state->ts * TICK_LENGTH / 1000.0;
	state->x += cos(state->angle) * state->v * TICK_LENGTH / 1000.0;
	state->y += sin(state->angle) * state->v * TICK_LENGTH / 1000.0;

	seg.x2 = state->x;
	seg.y2 = state->y;
	
	inhole = state->tick > usr->hstart 
	 && (state->tick + usr->hstart) % (usr->hsize + usr->hfreq) < usr->hsize;
	outside = state->x < 0 || state->x > usr->gm->w
	 || state->y < 0 || state->y > usr->gm->h;

	/* check for collisions and add segment to map if needed */
	if(aimap)
		cut = checkaimapcollision(usr, &seg, state->tick, solid, addsegments);
	else
		cut = checkcollision(usr->gm, &seg);

	if(cut != -1.0) {
		if(collidingseg->t) {
			struct teleport *t = collidingseg->t;
			double x = (1 - cut) * seg.x1 + cut * seg.x2;
			double y = (1 - cut) * seg.y1 + cut * seg.y2;
			double r = t->tall ? y - collidingseg->y1 : x - collidingseg->x1;
			
			/* we make sure to not cross the teleport */
			seg.x2 = x - cos(state->angle) / 10;
			seg.y2 = y - sin(state->angle) / 10;

			state->angle += t->anglediff;
			state->x = t->dest.x1 + t->dx * r + cos(state->angle) / 10;
			state->y = t->dest.y1 + t->dy * r + sin(state->angle) / 10;
			handled = 1; 
		} else if(!inhole || !HACKS) {
			dieseg = seg;
			state->x = seg.x2 = (1 - cut) * seg.x1 + cut * seg.x2;
			state->y = seg.y2 = (1 - cut) * seg.y1 + cut * seg.y2;
			state->alive = 0;
			handled = 1;
		}
	}

	if(addsegments && !inhole) {
		addsegmentfull(usr->gm, &seg, aimap, usr, state->tick, branch);
			
		if((SEND_SEGMENTS && !aimap) || (SEND_AIMAP_SEGMENTS && aimap))
			queueseg(usr->gm, &seg);
	}

	if(!handled && outside) {

		if(usr->gm->torus) {

			if(state->x > usr->gm->w)
				state->x = 0;
			else if(state->x < 0)
				state->x = usr->gm->w;

			if(state->y > usr->gm->h)
				state->y = 0;
			else if(state->y < 0)
				state->y = usr->gm->h;

		} else {
			state->alive = 0;
		}
	}
	
	if(DEBUGPOS) {
		char s[255];
		cJSON *j = jsoncreate("debugPos");
		sprintf(s, "%.*f, %.*f, %.*f, %d", 19 - (int)log10(state->x), state->x, 
			19 - (int)log10(state->y), state->y,
			19 - (int)log10(state->angle), state->angle, handled);
		jsonaddstr(j, "msg", s);
		jsonaddnum(j, "tick", state->tick);
		sendjson(j, usr);
		jsondel(j);
	}
	
	state->tick++;
}

void endgame(struct game *gm, struct user *winner) {
	struct user *usr;
	
	cJSON *json = jsoncreate("endGame");
	jsonaddnum(json, "winnerId", winner->id);
	airjson(json, gm, 0);
	jsondel(json);

	loggame(gm, "ended. winner = %d\n", winner->id);

	gamelistcurrent = 0;
	gm->state = (gm->type == GT_AUTO) ? GS_ENDED : GS_LOBBY;

	if(gm->state == GS_LOBBY) {
		gm->round = 0;

		for(usr = gm->usr; usr; usr = usr->nxt)
			usr->points = 0;
	}

	clearstartgame(gm);
}

void endround(struct game *gm) {
	struct user *usr, *roundwinner, *winner = gm->usr; /* winner until proven otherwise */
	int maxpoints = 0, secondpoints = 0;
	cJSON *json;

	if(DEBUG_MODE)
		printf("ending round of game %p\n", (void *) gm);

	loggame(gm, "round ended. duration: %3d sec, modifieds: %3d, timeadjustments: %3d\n", 
		gm->tick * TICK_LENGTH / 1000, gm->modifieds, gm->timeadjustments);

	if(SEND_SEGMENTS)
		airsegments(gm);

	for(roundwinner = gm->usr; roundwinner && !roundwinner->state.alive;
	 roundwinner = roundwinner->nxt);

	json = jsoncreate("endRound");
	jsonaddnum(json, "winnerId", roundwinner ? roundwinner->id : -1);
	jsonaddnum(json, "finalTick", gm->tick);
	airjson(json, gm, 0);
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
	
	clearstartround(gm);

	if((maxpoints >= gm->goal && maxpoints >= secondpoints + MIN_WIN_DIFF) || gm->n == 1) {
		endgame(gm, winner);
	}
	else {
		if(DEBUG_MODE)
			printf("round of game %p ended. round winner = %d\n", (void*) gm, roundwinner ? roundwinner->id : -1);
		startround(gm);
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
	
	airdeath(victim, gm->tick, reward);

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
			if(gm->aigame && usr->human && usr->aimapstate.tick == gm->tick) {
				no_collision_usr = usr;
				no_collision_tick = usr->branchtick;
				simuserfull(&usr->aimapstate, usr, 1, 1, 1, 0);
				no_collision_usr = 0;
			}
			if(gm->aigame && usr->human && gm->tick % USER_PREDICTION_INTERVAL == 0) {
				struct userpos pos = usr->aimapstate;
				int endtick = gm->tick + SERVER_DELAY / TICK_LENGTH + USER_PREDICTION_LENGTH;
				
				if(usr->branch) {
					gm->branch[usr->branch].tick = 0;
					gm->branch[usr->branch].closed = 1;
				}
				usr->branch = getnewbranch(gm);
				usr->branchtick = pos.tick;
				pos.turn = 0;

				while(pos.tick < endtick && pos.alive)
					simuserfull(&pos, usr, 1, 1, 1, usr->branch);
			}
			if(!usr->state.alive) {
				if(GOD_MODE)
					usr->state.alive = 1;
				else
					handledeath(usr);
			}
		}
	}

	if((SEND_SEGMENTS || SEND_AIMAP_SEGMENTS) && gm->tick % 1 == 0)
		airsegments(gm);
	
	if(gm->alive == 0 || (gm->n > 1 && gm->alive == 1 && !KEEP_PLAYING_ONE_ALIVE))
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
		
		airgamelist();
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
	
	if(usr->gm->aigame && usr->human) {
		no_collision_usr = usr;
		no_collision_tick = usr->branchtick;
		while(usr->aimapstate.tick < tick && usr->aimapstate.alive) {
			simuserfull(&usr->aimapstate, usr, 1, 1, 1, 0);
		}
		usr->aimapstate.turn = turn;
		simuserfull(&usr->aimapstate, usr, 1, 1, 1, 0);
		no_collision_usr = 0;
	}
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

	sendsteer(usr, tick, turn, delay);
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
	usr->human = 1;
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

	if(!usr->human)
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
	comp->human = 0;
	comp->name = smalloc(MAX_NAME_LENGTH + 1);
	strcpy(comp->name, COMPUTER_NAME);
	comp->inputmechanism = COMPUTER_AI;
	joingame(gm, comp);
}

/* pencil game. FIXME: deze functie is echt terror! nog steeds!!! */
void handlepencilmsg(cJSON *json, struct user *usr) {
	struct pencil *p = &usr->pencil;
	struct buffer buf;
	int lasttick = -1;
	char buffer_empty = 1;
	
	json = jsongetjson(json, "data");
	if(!json)
		return;
	json = json->child;
	
	buf.start = 0;
	allocroom(&buf, 200);
	appendheader(&buf, MODE_PENCIL, usr->index);
	
	while(json) {
		int x, y;
		int tick;
		char type;
		
		/* read next block */
		type = json->valueint;
		if(!(json = json->next)) break;
		x = json->valueint;
		if(!(json = json->next)) break;
		y = json->valueint;
		if(!(json = json->next)) break;
		tick = json->valueint;
		json = json->next;

		if(PENCIL_DEBUG)
			printf("pencilmsg type = %d, tick = %d, x = %d, y = %d\n", type, tick, x, y);
		
		if(tick < p->tick || x < 0 || y < 0 || x > usr->gm->w || y > usr->gm->h) {
			warningplayer(usr, "error: wrong pencil location or tick\n");
			break;
		}

		gototick(p, tick);

		if(type == PENCIL_MSG_DOWN) {
			if(p->ink <= MOUSEDOWN_INK - EPS) {
				warning("error: not enough ink for pencil down\n");
				break;
			}

			p->x = x;
			p->y = y;
			p->ink -= MOUSEDOWN_INK;
			p->down = 1;
			
			allocroom(&buf, 4);
			appendpos(&buf, x, y);
			appendpencil(&buf, 1, 0);
			
			buffer_empty = 0;
		}
		else {
			double d = getlength(p->x - x, p->y - y); // dubbel-D ? ;-)
			int tickSolid;
			struct pencilseg *pseg;
			struct seg *seg;

			if(PENCIL_DEBUG)
				printf("distance = %f, ink left = %f\n", d, p->ink);

			if(!p->down) {
				warningplayer(usr, "error: pencil move: pencil not down\n");
				break;
			}

			if(p->ink < d - EPS) {
				warningplayer(usr, "error: pencil move: not enough ink. %f required, %f left\n", d, p->ink);
				break;
			}

			if(d < INK_MIN_DISTANCE && type != -1) {
				warningplayer(usr, "error: too short distance for pencil move: %f\n", d);
				break;
			}

			p->ink -= d;
			tickSolid = max(tick, usr->gm->tick) + usr->gm->inkdelay / TICK_LENGTH; // FIXME: should be non-decreasing
			pseg = smalloc(sizeof(struct pencilseg));
			seg = &pseg->seg;

			allocroom(&buf, 6);
			appendpos(&buf, x, y);
			if(lasttick == -1) {
				appendpencil_full(&buf, 0, tickSolid);
			} else {
				if(tickSolid - lasttick > 63) {
					warningplayer(usr, "error: pencil move: too large tick gap of %d\n", tickSolid - lasttick);
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
			seg->t = 0;

			pseg->tick = tickSolid;
			pseg->nxt = p->pseghead;
			if(p->pseghead)
				p->pseghead->prev = pseg;
			pseg->prev = 0;
			p->pseghead = pseg;
			if(!p->psegtail)
				p->psegtail = pseg;
				
			if(usr->gm->aigame) {
				checkaimapcollision(usr, seg, tickSolid, 1, 1);
				addsegmentfull(usr->gm, seg, 1, usr, tickSolid, 0);
			}
			
			p->x = x;
			p->y = y;
			if(type == PENCIL_MSG_UP)
				p->down = 0;
		}
	}
	
	if(!buffer_empty)
		airstr(buf.start, buf.at - buf.start, usr->gm, 0);
	
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

/* to be called at startround */
void resetpencil(struct pencil *p, struct user *usr) {
	p->ink = START_INK;
	cleanpencil(p);
	p->usr = usr;
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
	double inc = ticks * TICK_LENGTH / 1000.0 * p->usr->gm->inkregen;

	if(PENCIL_DEBUG)
		printf("ticks = %d, oldink = %f, inc = %f, newink = %f\n", ticks, p->ink, inc, min(p->ink + inc, p->usr->gm->inkcap));

	p->tick = tick;
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
	sendsteer(usr, tick, turn, 0);
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
	sendsteer(usr, tick, turn, 0);
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
	newstate = *state; //memcpy(&newstate, state, sizeof(struct userpos)); 
	
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
		*pos = usr->state;

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
	sendsteer(usr, tick, turn, 0);
}

void inputmechanism_checktangent(struct user *usr, int tick) {
	int turn;
	struct seg seg;
	double visionlength;
	struct userpos *pos = &usr->aistate;

	if(tick == 0) {
		*pos = usr->state;
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
	sendsteer(usr, tick, turn, 0);
}

void truncatebranch(struct mapaidata *data, int tick, struct user *usr) {
	struct branch *branch;
	struct linkedbranch *nxt, *cur, *prev = 0;
	char once = 1;
	
	cur = data->headbranch;
	while(cur) {
		branch = usr->gm->branch + cur->branch;
		
		branch->tick = min(branch->tick, tick);
		nxt = cur->nxt;
		
		if(branch->tick <= usr->aimapstate.tick) {
			branch->closed = 1;
			free(cur);
			if(once) {
				once = 0;
				if(prev)
					prev->nxt = 0;
				else
					data->headbranch = 0;
			}
		}
		
		prev = cur;
		cur = nxt;
	}
}

int getnewbranch(struct game *gm) {
	if(!gm->branch) {
		gm->branchcap = 10;
		gm->branch = smalloc(sizeof(struct branch) * gm->branchcap);
		gm->branchlen = 1;
	} else if(gm->branchlen == gm->branchcap) {
		gm->branchcap *= 2;
		gm->branch = srealloc(gm->branch, sizeof(struct branch) * gm->branchcap);
	}
	
	gm->branch[gm->branchlen].closed = 0;
	gm->branch[gm->branchlen].tick = INT_MAX;
	return gm->branchlen++;
}

void newheadbranch(struct mapaidata *data, struct game *gm) {
	struct linkedbranch *lb = smalloc(sizeof(struct linkedbranch));
	
	lb->branch = getnewbranch(gm);
	lb->nxt = data->headbranch;
	data->headbranch = lb;
}

void allocinputroom(struct mapaidata *data, int tick) {
	if(!data->input) {
		data->inputcap = max(1024, tick);
		data->input = smalloc(data->inputcap);
	}
	if(data->inputcap < tick) {
		data->inputcap = max(data->inputcap * 2, tick);
		data->input = srealloc(data->input, data->inputcap);
	}
}

int recpath(struct user *usr, struct recdata *rd, int depth, int *computation) {
	struct recentry *b = rd->entry + depth, *c = rd->entry + depth + 1;
	int j, r,  *i = &b->i;
	struct userpos *pos = &b->pos, *newpos = &c->pos;
	
	if(rd->allowpause && *computation > AI_MAX_COMPUTATION * 5) {
		rd->stopdepth = depth;
		return 0;
	}
	
	r = !!(rd->randnum & (1 << depth));
	
	if(depth == rd->stopdepth)
		rd->stopdepth = -1;
	
	if(rd->stopdepth == -1) {
		*i = 0;
		pos->turn = b->turn;
		b->newbest = 0;
	}
	
	for(; *i < 3; *i = *i + 1,
	 pos->turn = (pos->turn + 2 + r) % 3 - 1) {
	
		if(rd->stopdepth == -1) {
			*newpos = *pos;
			
			dieseg.x1 = -1;
			for(j = 0; j < b->ticks; j++) {
				simuserfull(newpos, usr, 0, 1, 1, 0);
			}
			*computation += newpos->tick - pos->tick;
		}
		
		if(newpos->alive && depth < rd->maxdepth) {
			if(!recpath(usr, rd, depth + 1, computation)) {
				return 0;
			}
		}
		else {
			c->newbest = newpos->alive || newpos->tick > rd->bestpos.tick;
			
			if(c->newbest) {
				rd->bestpos = *newpos;
				rd->dieseg = dieseg;
			}
		}
		
		if(c->newbest) {
			b->bestturn = pos->turn;
			b->newbest = 1;
		}
		
		if(rd->bestpos.alive)
			break;
	}
	
	return 1;
}

void setupaidata(struct user *usr) {
	float x;
	struct mapaidata *data;
	struct game *gm = usr->gm;
	int i;
		
	data = usr->aidata = scalloc(sizeof(struct mapaidata), 1);
	data->dietick = INT_MAX;
	newheadbranch(data, gm);
	
	for(i = 0; i < AI_NUM_DODGE; i++) {
		x = AI_DODGE[i].length / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
		data->dodge[i].ticks = min(AI_MAX_TICKS, ceil(x));
		data->dodge[i].depth = AI_DODGE[i].depth;
	}
	
	x = AI_MIN_STEER / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
	data->minsteer_ticks = max(1, x);
	
	x = AI_MAX_STEER / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
	data->maxsteer_ticks = max(data->minsteer_ticks + 1, x);
	
	x = AI_PREDICTION_LENGTH / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
	data->prediction_ticks = x;

	for(x = 0; x < COMPUTER_DELAY; x++)
		simuserfull(&usr->aimapstate, usr, 1, 1, 1, 0);
		
	data->extendpos = usr->aimapstate;
	data->rd.stopdepth = -1;
}

void inirecdata(struct recdata *rd, struct userpos *pos, int depth) {
	memset(rd, 0, sizeof(struct recdata));
	rd->stopdepth = -1;
	rd->randnum = rand();
	rd->bestpos.tick = -1;
	rd->maxdepth = depth - 1;
	rd->entry[0].pos = *pos;
}

void scrambleticks(struct recentry *re, int num, int ticks) {
	if(num == 1)
		re->ticks = ticks;
	else if (num > 1){
		int b = ticks / num;
		int a = b / 2;
		int c = a + b;
		if(c - a > 0)
			b = rand() % (c - a) + a;
		else
			b = 1;
		
		re->ticks = b;
		scrambleticks(re + 1, num - 1, ticks - b);
	}
}

void copyinputs(struct mapaidata *data, struct recdata *rd, int endtick) {
	int tick, i;
	struct userpos *pos = &rd->entry[0].pos;
	
	allocinputroom(data, endtick);
	if(endtick > pos->tick)
		memset(data->input + pos->tick, 0, endtick - pos->tick);
	for(i = 0, tick = pos->tick; tick < endtick; tick += rd->entry[i++].ticks)
		data->input[tick] = rd->entry[i].bestturn + 2;
}

int setupdodge(struct user *usr, struct mapaidata *data, struct game *gm, struct recdata *rd) {
	int padding;
	struct dodge dodge = data->dodge[(int) data->nxtdodge];
	struct userpos pos = usr->aimapstate;

	/* get start position */
	dieseg.x1 = -1;
	padding = dodge.ticks * AI_PADDING_FRACTION;
	while(pos.tick < data->dietick - padding && pos.alive) {
		if(data->input[pos.tick])
			pos.turn = data->input[pos.tick] - 2;
		simuserfull(&pos, usr, 0, 1, 0, 0);
	}
	
	/* this should not happen */
	if(!pos.alive) {
		usr->dieseg = dieseg;
		usr->dietick = pos.tick;
		return 0;
	}
	
	inirecdata(rd, &pos, dodge.depth);
	rd->allowpause = 1;
	scrambleticks(rd->entry, dodge.depth, dodge.ticks);
	
	return 1;
}

void trynextdodge(struct user *usr, struct mapaidata *data, struct game *gm) {
	struct userpos pos;
	struct recdata *rd = &data->rd;
	int endtick;
	
	if(DEBUG_MAPAI_VERBOSE)
		printf("trying dodge %d\n", data->nxtdodge);

	/* check if we need to start or resume computation */
	if(rd->stopdepth == -1) {
		
		if(!setupdodge(usr, data, gm, rd))
			return;
	}
	else {
	
		if(rd->entry[0].pos.tick < usr->aimapstate.tick) {
			
			if(DEBUG_MAPAI)
				printf("aborting computation\n");
			data->nxtdodge = 1;
			rd->stopdepth = -1;
			return;
		}
		if(DEBUG_MAPAI_VERBOSE)
			printf("resuming computation\n");
	}
	
	/* special dodge */
	if(rd->maxdepth == -1) {
		truncatebranch(data, rd->entry[0].pos.tick, usr);
		newheadbranch(data, gm);
		data->extendpos = rd->entry[0].pos;
		data->nxtdodge = 0;
		data->dietick = INT_MAX;
		extendpath(usr, data, gm);
		return;
	}
		
	no_collision_usr = usr;
	no_collision_tick = rd->entry[0].pos.tick;
	recpath(usr, rd, 0, &data->computation);
	no_collision_usr = 0;

	/* check if we finished computation */
	if(rd->stopdepth == -1) {
		/* check if we found better path */
		if(rd->bestpos.tick > data->dietick || rd->bestpos.alive) {
		
			pos = rd->entry[0].pos;
			truncatebranch(data, pos.tick, usr);
			newheadbranch(data, gm);
			endtick = rd->bestpos.tick - !rd->bestpos.alive;
			copyinputs(data, rd, endtick);
			
			/* add segments to aimap */
			data->computation += endtick - pos.tick;
			while(pos.tick < endtick && pos.alive) {
				if(data->input[pos.tick])
					pos.turn = data->input[pos.tick] - 2;
				simuserfull(&pos, usr, 1, 1, 0, data->headbranch->branch);
			}
			
			if(rd->bestpos.alive) {
				data->dietick = INT_MAX;
				data->extendpos = pos;
				data->nxtdodge = 0;
			} else {
				data->dieseg = rd->dieseg;
				data->dietick = rd->bestpos.tick;
			}
		}
		if(data->dietick < INT_MAX) {
			data->nxtdodge = (data->nxtdodge + 1) % AI_NUM_DODGE;
		}
	}
}

void extendpath(struct user *usr, struct mapaidata *data, struct game *gm) {
	struct userpos pos = data->extendpos;
	struct recdata *rd = &data->rd;
	int depth = data->dodge[0].depth, ticks = data->dodge[0].ticks;
	int endtick;

	if(DEBUG_MAPAI_VERBOSE)
		printf("extending path\n");

	inirecdata(rd, &pos, depth);
	
	/* do small steer with certain probability (1/ 4) */
	if((rand() & 3) == 0) {
		int steerticks = rand() % (data->maxsteer_ticks - data->minsteer_ticks) + data->minsteer_ticks;
		
		if(depth == 1)
			steerticks = ticks;
		else {
			steerticks = min(steerticks, ticks - depth);
			scrambleticks(rd->entry + 1, depth - 1, ticks - steerticks);
		}
		
		rd->entry[0].turn = (rand() & 2) - 1;
		rd->entry[0].ticks = steerticks;
	}
	else
		scrambleticks(rd->entry, depth, ticks);
	
	recpath(usr, rd, 0, &data->computation);
	endtick = rd->bestpos.tick - !rd->bestpos.alive;
	copyinputs(data, rd, endtick);
	
	if(SEND_AIMAP_SEGMENTS) {
		struct seg seg;
		seg.x1 = seg.x2 = pos.x;
		seg.y1 = seg.y2 = pos.y;
		queueseg(gm, &seg);
	}
	
	/* add segments to aimap */
	data->computation += endtick - pos.tick;
	while(pos.tick < endtick && pos.alive) {
		if(data->input[pos.tick])
			pos.turn = data->input[pos.tick] - 2;
		simuserfull(&pos, usr, 1, 1, 0, data->headbranch->branch);
	}
	
	if(!rd->bestpos.alive) {
		data->dietick = rd->bestpos.tick;
		data->dieseg = rd->dieseg;
		data->nxtdodge = 1;

		if(DEBUG_MAPAI)
			printf("couldnt extend collision free!\n");
	}
	else
		data->extendpos = pos;
}

void inputmechanism_mapai(struct user *usr, int tick) {
	struct mapaidata *data = (struct mapaidata *)usr->aidata;
	struct game *gm = usr->gm;

	if(!tick) {
		setupaidata(usr);
		data = (struct mapaidata *)usr->aidata;
	}
	
	tick += COMPUTER_DELAY;
	
	/* check if our future path suddenly collides with something */
	if(usr->dietick < INT_MAX) {
	
		data->dietick = usr->dietick;
		data->dieseg = usr->dieseg;
		data->nxtdodge = 1;
		usr->dietick = INT_MAX;
		truncatebranch(data, data->dietick, usr);
	}
	else if(data->dietick < INT_MAX && !data->nxtdodge) {
	
		/* check if danger has passed */
		if(data->dieseg.x1 != -1 && checkaimapcollision(usr, &data->dieseg, data->dietick - 1, 1, 0) == -1) {
			data->dietick = INT_MAX;
			data->nxtdodge = 0;
			data->rd.stopdepth = -1;
			if(DEBUG_MAPAI)
				printf("danger has passed\n");
		}
	}
	
	if(data->computation > 0) {
	
		/* we did too many computations and now should wait */
		if(DEBUG_MAPAI)
			printf("computation excess %d\n", data->computation);
	} 
	else if(data->nxtdodge) {
		
		trynextdodge(usr, data, gm);
	}
	else if(data->extendpos.tick - tick < data->prediction_ticks && data->dietick == INT_MAX) {
		
		extendpath(usr, data, gm);
	}
	
	/* tell everyone about our input */
	if(data->inputcap > tick && data->input[tick]) {
		int turn = data->input[tick] - 2;

		if(turn != usr->lastinputturn) {
			usr->aimapstate.turn = turn;
			queueinput(usr, tick, usr->aimapstate.turn);
			sendsteer(usr, tick, usr->aimapstate.turn, 0);
		}
	}

	if(data->computation > 0)
		data->computation -= AI_MAX_COMPUTATION;
	simuserfull(&usr->aimapstate, usr, 0, 1, 0, 0);
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
