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

		if(jsoncheckjson(j, "mode") && !strcmp(jsongetstr(j, "mode"), "playerStart")) {
			seg->x2 = jsongetdouble(j, "angle");
			seg->nxt = map->playerstarts;
			map->playerstarts = seg;
		}
		else {
			if(!seginside(seg, MAX_GAME_WIDTH, MAX_GAME_HEIGHT) || 
					(seg->x1 == seg->x2 && seg->y1 == seg->y2)) {
				warning("createmap segment out of boundaries or zero-length error\n");
				free(seg);
				j = j->next;
				continue;
			}

			if(jsoncheckjson(j, "mode") && !strcmp(jsongetstr(j, "mode"), "teleport")) {
				int id = jsongetint(j, "teleportId");

				if(id < 0 || id >= MAX_TELEPORTS) {
					warning("invalid teleporter id\n");
					free(seg);
					j = j->next;
					continue;
				}

				if(!telbuffer[id]) {
					telbuffer[id] = seg;
				} else if(telbuffer[id] == &taken) {
					warning("createmap teleport error\n");
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
			if(gm->aigame && (usr->inputmechanism != inputmechanism_mapai) && usr->aimapstate.tick == gm->tick) {
				no_collision_usr = usr;
				no_collision_tick = usr->branchtick;
				simuserfull(&usr->aimapstate, usr, 1, 1, 1, 0);
				no_collision_usr = 0;
			}
			if(gm->aigame && (usr->inputmechanism != inputmechanism_mapai) && gm->tick % USER_PREDICTION_INTERVAL == 0) {
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

	if((SEND_SEGMENTS || SEND_AIMAP_SEGMENTS) && gm->tick % 1 == 0) // huh? is dat laatste niet altijd waar?
		airsegments(gm);
	
	if(gm->alive == 0 || (gm->n > 1 && gm->alive == 1 && !KEEP_PLAYING_ONE_ALIVE))
		endround(gm);
	else
		gm->tick++;
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
	
	if(usr->gm->aigame && (usr->inputmechanism != inputmechanism_mapai)) {
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
