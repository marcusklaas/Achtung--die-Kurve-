void newgamelist() {
	cJSON *games;

	assert(!pthread_mutex_lock(&gamelistlock));
	games = encodegamelist();
	pthread_mutex_unlock(&gamelistlock);

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

void unlinkgame(struct game *gm) {
	assert(!pthread_mutex_lock(&gamelistlock));

	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}
	
	pthread_mutex_unlock(&gamelistlock);
}

void remgame(struct game *gm) {
	struct user *usr, *nxt;

	if(DEBUG_MODE)
		printf("deleting game %p\n", (void *) gm);
		
	unlinkgame(gm);
	gm->state = GS_REMOVING_GAME;

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
		gm->goal = GOAL;
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

/* only call this function when owning the game lock! */
void leavegame(struct user *usr, int reason) {
	struct game *gm = usr->gm;
	struct user *curr;
	char buf[20];
	cJSON *json;

	//assert(EDEADLK == pthread_mutex_lock(&gm->lock));
	
	if(DEBUG_MODE && gm->type != GT_LOBBY) {
		printf("user %d is leaving his game!\n", usr->id);
		fflush(stdout);
	}
	
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

	if(gm->host == usr) {
		gm->host = curr;
		gamelistcurrent = 0;

		if(curr)
			airhost(gm);
	}

	if(curr) {
		json = jsoncreate("playerLeft");
		jsonaddnum(json, "playerId", usr->id);
		jsonaddstr(json, "reason", leavereasontostr(reason, buf));
		airjson(json, gm, 0);
		jsondel(json);
	}

	gm->n--;
	usr->nxt = 0;
	usr->gm = 0;
	userclearstartround(usr);

	if(gm->type != GT_LOBBY) {
		if(!curr)
			gm->state = GS_REMOVING_GAME;
		else if(gm->state == GS_STARTED && gm->n == 1)
			endround(gm);
	}

	if(DEBUG_MODE) printgames();
}

void joingame(struct game *gm, struct user *newusr) {
	struct user *usr;
	char buf[20];
	cJSON *json;
	
	if(DEBUG_MODE) {
		printf("user %d is joining game %p\n", newusr->id, (void*)gm);
		fflush(stdout);
	}

	if(newusr->gm) {
		struct game *oldgame = newusr->gm;
		assert(!pthread_mutex_lock(&oldgame->lock));
		leavegame(newusr, LEAVE_NORMAL);
		pthread_mutex_unlock(&oldgame->lock);
	}
	
	newusr->gm = gm;
	newusr->points = 0;
	
	assert(!pthread_mutex_lock(&gm->lock)); // lock game

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
	
	pthread_mutex_unlock(&gm->lock); // unlock game
	gamelistcurrent = 0;

	if(DEBUG_MODE) {
		printf("user %d joined game %p\n", newusr->id, (void *)gm);
		printgames();
	}
}

/* thread-safe */
void kickplayer(struct user *host, int victimid) {
	struct game *gm = host->gm;
	struct user *victim = findplayer(gm, victimid);
	struct kicknode *kick;

	if(!victim || gm->host != host || gm->state != GS_LOBBY) {
		warning("user %d tried to kick usr %d, but does"
		 " not meet requirements\n", host->id, victimid);
		return;
	}

	log("host %d kicked user %d\n", host->id, victimid);
	assert(!pthread_mutex_lock(&gm->lock));

	leavegame(victim, LEAVE_KICKED);

	if(victim->human) {
		cJSON *j = jsoncreate("kickNotification");
		
		kick = smalloc(sizeof(struct kicknode));
		kick->usr = victim;
		kick->expiration = servermsecs() + KICK_REJOIN_TIME;
		kick->nxt = gm->kicklist;
		gm->kicklist = kick;

		sendjson(j, victim);
		jsondel(j);
		joingame(lobby, victim);
	}
	else
		deleteuser(victim);
		
	pthread_mutex_unlock(&gm->lock);
}

/* loop run by each game's thread */
static void *gameloop(void *gameptr) {
	struct game *gm = (struct game *) gameptr;
	long sleeptime;
	
	while(gm->state != GS_REMOVING_GAME) {
		if(gm->state == GS_STARTED)
			sleeptime = gm->tick * TICK_LENGTH + SERVER_DELAY + gm->start - servermsecs();
		else
			sleeptime = TICK_LENGTH;	
		
		if(sleeptime > 0)
			msleep(sleeptime);
			
		assert(!pthread_mutex_lock(&gm->lock)); // lock game
		if(gm->state == GS_STARTED)
			simgame(gm);

		resetspamcounters(gm, serverticks);
		pthread_mutex_unlock(&gm->lock); // we done
	}
	
	remgame(gm);
	
	return (void *) 5000;
}

/* loop run by lobby */
static void *lobbyloop(void *ptr) {
	while(5000) {
		assert(!pthread_mutex_lock(&lobby->lock));
		airgamelist();
		resetspamcounters(lobby, serverticks++);
		pthread_mutex_unlock(&lobby->lock);
		msleep(TICK_LENGTH);
	}
	
	return (void *) 0;
}

struct game *creategame(int gametype, int nmin, int nmax) {
	struct game *gm = scalloc(1, sizeof(struct game));
	pthread_attr_t thread_attr;

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
	gm->goal = GOAL;
	gm->torus = TORUS_MODE;
	gm->inkcap = MAX_INK;
	gm->inkregen = INK_PER_SEC;
	gm->inkdelay = INK_SOLID;
	gm->inkstart = START_INK;
	gm->inkmousedown = MOUSEDOWN_INK;
	gm->hsize = HOLE_SIZE;
	gm->hfreq = HOLE_FREQ;

	assert(!pthread_mutex_lock(&gamelistlock));
	gm->nxt = headgame;
	headgame = gm;
	pthread_mutex_unlock(&gamelistlock);

	pthread_attr_init(&thread_attr);
	pthread_attr_setdetachstate(&thread_attr, PTHREAD_CREATE_DETACHED);

	pthread_mutex_init(&gm->lock, 0);
	pthread_create(&gm->thread, &thread_attr, gameloop, (void *) gm);

	return gm;
}

void iniuser(struct user *usr, struct libwebsocket *wsi) {
	memset(usr, 0, sizeof(struct user));
	usr->id = usrc++;
	usr->wsi = wsi;
	usr->inputmechanism = inputmechanism_human;
	usr->human = 1;
	pthread_mutex_init(&usr->comlock, 0);
}

void deleteuser(struct user *usr) {
	int i;
	
	if(usr->gm) {
		struct game *gm = usr->gm;
		assert(!pthread_mutex_lock(&gm->lock));
		leavegame(usr, LEAVE_DISCONNECT);
		pthread_mutex_unlock(&gm->lock);
	}

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

void addcomputer(struct game *gm, char *type) {
	struct user *comp;
	int i;
	
	for(i = 0; i < NUM_AI; i++)
		if(!strcmp(type, AI_TYPE_NAME[i]))
			break;
	
	if(i == NUM_AI)
		return;
	
	loggame(gm, "adding computer of type %s\n", type);
	comp = smalloc(sizeof(struct user));
	iniuser(comp, 0);
	comp->human = 0;
	comp->name = smalloc(MAX_NAME_LENGTH + 1);
	strcpy(comp->name, AI_NAME[i]);
	comp->inputmechanism = AI_INPUTMECHANISM[i];
	comp->strength = AI_STRENGTH[i];
	joingame(gm, comp);
}
