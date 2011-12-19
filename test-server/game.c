void randomizePlayerStarts(struct game *gm, float *buf) {
	// diameter of your circle in pixels when you turn at max rate
	int i, turningCircle = ceil(2.0 * VELOCITY/ TURN_SPEED);

	if(DEBUG_MODE)
		printf("Entered randomization\n");

	for(i = 0; i < gm->n; i++) {
		buf[3 * i] = turningCircle + rand() % (gm->w - 2 * turningCircle);
		buf[3 * i + 1] = turningCircle + rand() % (gm->h - 2 * turningCircle);
		buf[3 * i + 2] = rand() % 618 / 100.0;
	}
}

/* this is neccesary because when user joins second game, s/he gets 
 * INPUT MESSAGE OUT OF ORDER errors */
void clearinputqueue(struct user *usr) {
	struct userinput *inp, *nxt;

	for(inp = usr->inputhead; inp; inp = nxt) {
		nxt = inp->nxt;
		free(inp);
	}

	usr->inputhead = usr->inputtail = 0;
}

void startgame(struct game *gm){ 
	if(DEBUG_MODE)
		printf("startgame called!\n");

	float *player_locations = smalloc(3 * gm->n * sizeof(float));
	randomizePlayerStarts(gm, player_locations);

	gm->start = servermsecs() + COUNTDOWN;
	gm->state = GS_STARTED;
	gm->alive = gm->n;

	// create JSON object
	cJSON *root = jsoncreate("startGame");
	jsonaddnum(root, "startTime", (int)gm->start);
	cJSON *start_locations = cJSON_CreateArray();
	struct usern *usrn;
	struct user *usr;
	int i = 0;

	/* set the players locs and fill json object */
	for(usrn = gm->usrn; usrn; usrn = usrn->nxt) {
		usr = usrn->usr;

		usr->cx = usr->x = player_locations[3 * i];
		usr->cy = usr->y = player_locations[3 * i + 1];
		usr->cangle= usr->angle = player_locations[3 * i + 2];
		usr->turn = usr->cturn= 0;
		usr->alive= 1;
		usr->ctick= 0;

		cJSON *player = cJSON_CreateObject();
		cJSON_AddNumberToObject(player, "playerId", usr->id);
		cJSON_AddNumberToObject(player, "startX", usr->x);
		cJSON_AddNumberToObject(player, "startY", usr->y);
		cJSON_AddNumberToObject(player, "startAngle", usr->angle);
		cJSON_AddItemToArray(start_locations, player);

		i++;
	}

	/* spreading the word to all in the game */
	cJSON_AddItemToObject(root, "startPositions", start_locations);
	sendjsontogame(root, gm, 0);	
	
	free(player_locations);
	jsondel(root);
}

void remgame(struct game *gm){
	if(DEBUG_MODE)
		printf("remgame called\n");

	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}

	/* freeing up player nodes. */
	struct usern *next, *current;
	
	for(current = gm->usrn; current; current = next) {
		next = current->nxt;
		current->usr->gm= 0;
		clearinputqueue(current->usr);
		free(current);
	}

	/* freeing up segments */
	int i, num_tiles = gm->htiles * gm->vtiles;

	for(i=0; i < num_tiles; i++) {
		struct seg *a, *b;

		for(a = gm->seg[i]; a; a = b) {
			b = a->nxt;
			free(a);
		}
	}

	free(gm->seg);
	free(gm);
}

struct game *findgame(int nmin, int nmax) {
	struct game *gm;

	if(DEBUG_MODE)
		printf("findgame called \n");

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->state == GS_LOBBY && gm->nmin <= nmax && gm->nmax >= nmin) {
			gm->nmin = (gm->nmin > nmin) ? gm->nmin : nmin;
			gm->nmax = (gm->nmax < nmax) ? gm->nmax : nmax;
			return gm;
		}

	return NULL;
}

void leavegame(struct user *u) {
	struct game *gm = u->gm;
	struct usern *current, *tmp;

	if(DEBUG_MODE)
		printf("leavegame called \n");

	clearinputqueue(u);
	
	if(gm->usrn->usr == u){
		tmp= gm->usrn;
		gm->usrn= gm->usrn->nxt;
		free(tmp);
	}else{
		for(current = gm->usrn; current->nxt && current->nxt->usr != u; current = current->nxt);
		tmp = current->nxt;
		current->nxt = tmp->nxt;
		free(tmp);
	}

	gm->alive -= u->alive;

	if(--gm->n == 0)
		remgame(gm);
	else {
		// send message to group: this player left
		cJSON *json = jsoncreate("playerLeft");
		jsonaddnum(json, "playerId", u->id);
		sendjsontogame(json, gm, 0);
		cJSON_Delete(json);
	}

	u->gm = NULL;	
	
	if(DEBUG_MODE) printgames();
}

void joingame(struct game *gm, struct user *u) {
	struct usern *usrn;
	cJSON *json;
	char *lastusedname;

	if(DEBUG_MODE)
		printf("join game called \n");
		
	// tell user s/he joined a game. 
	json= jsoncreate("joinedGame");
	sendjson(json, u);
	jsondel(json);
	
	json= getjsongamepars(gm);
	sendjson(json, u);
	jsondel(json);
		
	// tell players of game someone new joined
	json= jsoncreate("newPlayer");
	jsonaddnum(json, "playerId", u->id);
	jsonaddstr(json, "playerName", lastusedname = u->name);
	sendjsontogame(json, gm, 0);

	printf("user %d has name %s\n", u->id, u->name);
	
	// send a message to the new player for every other player that is already in the game
	for(usrn = gm->usrn; usrn; usrn = usrn->nxt) {
		jsonsetnum(json, "playerId", usrn->usr->id);
		jsonsetstr(json, "playerName", lastusedname = usrn->usr->name);
		sendjson(json, u);

		printf("user %d has name %s\n", usrn->usr->id, usrn->usr->name);
	}
	
	// here we replace the playername by a duplicate so that the original
	// name doesnt get freed
	jsonsetstr(json, "playerName", duplicatestring(lastusedname));
	jsondel(json);
	
	usrn = smalloc(sizeof(struct usern));
	usrn->usr = u;
	usrn->nxt = gm->usrn;
	gm->usrn = usrn;
	u->gm = gm;

	if(++gm->n >= gm->nmin)
		startgame(gm);
	
	if(DEBUG_MODE){
		printf("user %d joined game %p\n", u->id, (void *)gm);
		printgames();
	}
}

struct game *creategame(int nmin, int nmax) {
	struct game *gm = smalloc(sizeof(struct game));

	if(DEBUG_MODE)
		printf("creategame called \n");

	gm->nmin = nmin; gm->nmax = nmax;
	gm->start = 0;
	gm->n = 0;
	gm->usrn = 0;
	gm->tick = 0;
	gm->alive = 0;
	gm->w= GAME_WIDTH;
	gm->h= GAME_HEIGHT;
	gm->tilew = TILE_WIDTH;
	gm->tileh = TILE_HEIGHT;
	gm->htiles= ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles= ceil(1.0 * gm->h / gm->tileh);
	gm->state= GS_LOBBY;
	gm->v= VELOCITY;
	gm->ts= TURN_SPEED;
	gm->nxt = headgame;
	headgame = gm;
	gm->seg = calloc(gm->htiles * gm->vtiles, sizeof(struct seg*));
	if(!gm->seg) {
		printf("Calloc failed in creategame!\n");
		exit(500);
	}

	return gm;
}

// returns 1 if collision, 0 if no collision
int segcollision(struct seg *seg1, struct seg *seg2) {
	// ok we dont want two consecutive segments from player to collide
	if(seg1->x2 == seg2->x1 && seg1->y2 == seg2->y1)
		return 0;

	float denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	float numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	float numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);

	/* segments are parallel */
	if(fabs(denom) < EPS){
		/* segments are on same line */
		if(fabs(numer_a) < EPS && fabs(numer_b) < EPS) {
			float a, b, c, d, e;
		
			if(seg1->x1 - seg1->x2 < EPS) {
				a= seg1->y1; b= seg1->y2; c= seg2->y1; d= seg2->y2;
			} else {
				a= seg1->x1; b= seg1->x2; c= seg2->x1; d= seg2->x2;
			}
		
			if(a>b) { e=a; a=b; b=e; }
			if(c>d) { e=c; c=d; d=c; }
		
			return (c < b && d > a);
		}

		return 0;
	}

	float a = numer_a/ denom;
	float b = numer_b/ denom;

	if(a < 0 || a > 1 || b < 0 || b > 1)
		return 0;

	return 1;
}

// returns 1 in case the segment intersects the box
int lineboxcollision(struct seg *seg, int left, int bottom, int right, int top) {
	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 < right && seg->y1 >= bottom && seg->y1 < top)
		return 1;

	if(seg->x2 >= left && seg->x2 < right && seg->y2 >= bottom && seg->y2 < top)
		return 1;

	struct seg edge;

	/* check intersect left border */
	edge.x1 = edge.x2 = left;
	edge.y1 = bottom;
	edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect right border */
	edge.x1 = edge.x2 = right;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.x1 = left;
	edge.y1 = edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.y1 = edge.y2 = bottom;
	if(segcollision(seg, &edge))
		return 1;

	return 0;
}

// returns 1 in case of collision, 0 other wise
// TODO: it would be super nice if we would cut of the latter part of the segment 
// if it intersects an existing segment
int addsegment(struct game *gm, struct seg *seg) {
	int left_tile, right_tile, bottom_tile, top_tile, swap, collision = 0;
	struct seg *current, *copy;

	left_tile = seg->x1/ gm->tilew;
	right_tile = seg->x2/ gm->tilew;
	if(left_tile > right_tile) {
		swap = left_tile; left_tile = right_tile; right_tile = swap;
	}

	bottom_tile = seg->y1/ gm->tileh;
	top_tile = seg->y2/ gm->tileh;
	if(bottom_tile > top_tile) {
		swap = bottom_tile; bottom_tile = top_tile; top_tile = swap;
	}

	/* run off screen */
	if(seg->x2 < 0 || seg->x2 >= gm->w || seg->y2 < 0 || seg->y2 >= gm->h) {
		collision = 1;

		left_tile = (left_tile < 0) ? 0 : left_tile;
		right_tile = (right_tile >= gm->htiles) ? (gm->htiles - 1) : right_tile;
		bottom_tile = (bottom_tile < 0) ? 0 : bottom_tile;
		top_tile = (top_tile >= gm->vtiles) ? (gm->vtiles - 1) : top_tile;
	}		

	for(int i = left_tile; i <= right_tile; i++) {
		for(int j = bottom_tile; j <= top_tile; j++) {
			if(!lineboxcollision(seg, i * gm->tilew, j * gm->tileh,
			 (i + 1) * gm->tilew, (j + 1) * gm->tileh))
				continue;

			for(current = gm->seg[gm->htiles * j + i]; current; current = current->nxt)
				if(segcollision(current, seg)) {
					printseg(current);printf(" collided with ");printseg(seg);printf("\n");
					collision = 1;
					break;
				}

			// add the seg to the list, even if it intersects
			copy = smalloc(sizeof(struct seg));
			memcpy(copy, seg, sizeof(struct seg));
			copy->nxt = gm->seg[gm->htiles * j + i];
			gm->seg[gm->htiles * j + i] = copy;
		}
	}

	// we dont need the original any more: free it
	free(seg);

	return collision;
}

// simulate user tick. returns 1 if player dies during this tick, 0 otherwise
int simuser(struct user *usr, long simstart) {
	/* usr sent us more than 1 input in a single tick? that's weird! might be
	 * possible though. ignore all but last */
	struct userinput *prev;

	while(usr->inputhead && usr->inputhead->time < simstart) {
		usr->turn = usr->inputhead->turn;
		prev = usr->inputhead;
		usr->inputhead = usr->inputhead->nxt;
		free(prev);
	}

	if(!usr->inputhead)
		usr->inputtail = 0;

	struct seg *newseg = smalloc(sizeof(struct seg));
	newseg->nxt = 0;
	newseg->x1 = usr->x;
	newseg->y1 = usr->y;

	// turn first
	usr->angle += usr->turn * usr->gm->ts * TICK_LENGTH / 1000.0;
	usr->x += cos(usr->angle) * usr->gm->v * TICK_LENGTH / 1000.0;
	usr->y += sin(usr->angle) * usr->gm->v * TICK_LENGTH / 1000.0;

	newseg->x2 = usr->x;
	newseg->y2 = usr->y;
	
	return addsegment(usr->gm, newseg);
}

// simulate game tick
void simgame(struct game *gm) {
	struct usern *usrn;
	long simstart;

	// we beginnen te ticken na gm->start + SERVER_DELAY
	if(servermsecs() < gm->start + SERVER_DELAY)
		return;

	simstart= gm->tick++ * TICK_LENGTH;

	for(usrn = gm->usrn; usrn; usrn = usrn->nxt){
		struct user *u= usrn->usr;
		if(u->alive && simuser(u, simstart)){
			if(DEBUG_MODE)
				printf("Player %d died\n", u->id);

			u->alive= 0;
			gm->alive--;

			// send message to group: this player died
			cJSON *json = jsoncreate("playerDied");
			jsonaddnum(json, "playerId", u->id);
			sendjsontogame(json, gm, 0);
			cJSON_Delete(json);
		}
	}
	
	if(gm->alive <= 1 && (gm->nmin > 1 || gm->alive < 1)) {
		cJSON *json= jsoncreate("endGame");
		struct user *winner = 0;

		for(usrn = gm->usrn; usrn; usrn = usrn->nxt)
			if(usrn->usr->alive){
				winner= usrn->usr;
				break;
			}
		jsonaddnum(json, "winnerId", winner ? winner->id : -1);
		sendjsontogame(json, gm, 0);
		jsondel(json);
		
		printf("game %p ended. winnerId = %d\n", (void*)gm, winner ? winner->id : -1);
		remgame(gm);
	}
}

// deze functie called simgame zo goed als mogelijk elke TICK_LENGTH msec (voor elke game)
void mainloop() {
	int sleepuntil;
	struct game *gm, *nxtgm;

	while(1) {
		for(gm = headgame; gm; gm = nxtgm){
			nxtgm= gm->nxt; // in the case that gm gets freed
			if(gm->state == GS_STARTED)
				simgame(gm);
		}
		
		sleepuntil= ++serverticks * TICK_LENGTH;
		do{
			libwebsocket_service(ctx, sleepuntil - servermsecs());
		}while(sleepuntil - servermsecs() > 0);
	}
}

void interpretinput(cJSON *json, struct user *usr) {
	struct userinput *input;
	int time= jsongetint(json, "gameTime");
	int turn= jsongetint(json, "turn");
	
	// some checks
	if(turn < -1 || turn > 1){
		if(SHOW_WARNING)
			printf("invalid user input received from user %d.\n", usr->id);
		return;
	}

	if(usr->inputtail && time < usr->inputtail->time){
		if(SHOW_WARNING)
			printf("input messages of user %d are being received out of order!\n", usr->id);
		return;
	}

	if(!usr->alive) {
		if(SHOW_WARNING)
			printf("received input for dead user %d? ignoring..\n", usr->id);
		return;
	}

	if(servermsecs() - usr->gm->start - time > MAX_MESSAGE_DELAY){
		if(SHOW_WARNING)
			printf("received msg from user %d of %d msec old! modifying message..\n",
			 usr->id, (int) (servermsecs() - usr->gm->start - time));
		time = servermsecs() - usr->gm->start - MAX_MESSAGE_DELAY;
	}
	
	// put it in user queue
	input = smalloc(sizeof(struct userinput));
	input->time = time;
	input->turn = turn;
	input->nxt = 0;
	
	if(!usr->inputtail)
		usr->inputhead = usr->inputtail = input;
	else
		usr->inputtail = usr->inputtail->nxt = input; // ingenious or wat
		
	// check if user needs to adjust her gametime
	usr->delta[usr->deltaat++]= input->time - (servermsecs() - usr->gm->start);
	if(usr->deltaat == DELTA_COUNT) {
		usr->deltaat= 0;
		usr->deltaon= 1;
	}
	if(usr->deltaon){
		int max= 0, i, tot= 0;
		for(i= 0;i < DELTA_COUNT; i++){
			if(usr->delta[i] > max){
				tot += max;
				max= usr->delta[i];
			}else
				tot += usr->delta[i];
		}
		tot /= DELTA_COUNT - 1;
		if(tot > DELTA_MAX || tot < DELTA_MAX * -1){
			cJSON *j= jsoncreate("adjustGameTime");
			jsonaddnum(j, "forward", tot);
			usr->deltaon= 0;
			usr->deltaat= 0;
		}
	}
	
	// send to other players
	{
		int simstart= usr->ctick * TICK_LENGTH;
		// we maken nieuwe json voor het geval dat de user allemaal shit
		// mee heeft gestuurd in de json die we anders naar de rest zouden
		// spammen
		cJSON *j= jsoncreate("newInput");
		while(simstart <= input->time){
			usr->cangle += usr->cturn * usr->gm->ts * TICK_LENGTH / 1000.0;
			usr->cx += cos(usr->cangle) * usr->gm->v * TICK_LENGTH / 1000.0;
			usr->cy += sin(usr->cangle) * usr->gm->v * TICK_LENGTH / 1000.0;
			usr->ctick++;
			simstart += TICK_LENGTH;
		}
		usr->cturn= input->turn;
		jsonaddnum(j, "gameTime", time);
		jsonaddnum(j, "playerId", usr->id);
		jsonaddnum(j, "turn", turn);
		jsonaddnum(j, "x", usr->cx);
		jsonaddnum(j, "y", usr->cy);
		jsonaddnum(j, "angle", usr->cangle);

		// FOR TESTING (only?): send to usr too
		sendjsontogame(j, usr->gm, 0); //usr);
		jsondel(j);
	}
}

