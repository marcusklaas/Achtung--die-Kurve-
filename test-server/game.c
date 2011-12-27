void randomizePlayerStarts(struct game *gm) {
	// diameter of your circle in pixels when you turn at max rate
	int turningCircle = ceil(2.0 * gm->v/ gm->ts);
	struct user *usr;

	if(DEBUG_MODE)
		printf("Entered randomization\n");

	/* set the players locs and hstart */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		usr->x = turningCircle + rand() % (gm->w - 2 * turningCircle);
		usr->y =  turningCircle + rand() % (gm->h - 2 * turningCircle);
		usr->angle = rand() % 628 / 100.0;
		usr->hstart = gm->hmin + rand() % (gm->hmax - gm->hmin + 1);
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

	randomizePlayerStarts(gm);

	gm->start = serverticks * TICK_LENGTH + COUNTDOWN;
	gm->tick = -(COUNTDOWN + SERVER_DELAY) / TICK_LENGTH;
	gm->state = GS_STARTED;
	gm->alive = gm->n;

	// create JSON object
	cJSON *root = jsoncreate("startGame");
	cJSON *start_locations = cJSON_CreateArray();
	struct user *usr;

	/* set the players locs and fill json object */
	for(usr = gm->usr; usr; usr = usr->nxt) {
		clearinputqueue(usr);
		usr->turn = 0;
		usr->alive= 1;
		if(gm->pencilgame)
			resetpencil(&usr->pencil, usr);

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

void remgame(struct game *gm){
	if(DEBUG_MODE)
		printf("deleting game %p\n", (void *) gm);

	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}

	/* freeing up player nodes. */
	struct user *usr, *nxt;

	for(usr = gm->usr; usr; usr = nxt) {
		nxt = usr->nxt;
		usr->gm = 0;
		if(gm->pencilgame)
			cleanpencil(&usr->pencil);
		usr->nxt = 0;
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

void leavegame(struct user *usr) {
	struct game *gm = usr->gm;
	struct user *curr;

	if(DEBUG_MODE)
		printf("leavegame called \n");

	if(gm->usr == usr) {
		gm->usr = usr->nxt;
	}else{
		for(curr = gm->usr; curr->nxt && curr->nxt != usr; curr = curr->nxt);
		curr->nxt = usr->nxt;
	}

	gm->alive -= usr->alive;
	usr->nxt = 0;
	usr->gm = 0;

	if(--gm->n == 0)
		remgame(gm);
	else {
		// send message to group: this player left
		cJSON *json = jsoncreate("playerLeft");
		jsonaddnum(json, "playerId", usr->id);
		sendjsontogame(json, gm, 0);
		cJSON_Delete(json);
	}

	if(DEBUG_MODE) printgames();
}

void joingame(struct game *gm, struct user *newusr) {
	struct user *usr;
	cJSON *json;
	char *lastusedname;

	if(DEBUG_MODE)
		printf("join game called \n");

	// tell user s/he joined a game.
	json= jsoncreate("joinedGame");
	sendjson(json, newusr);
	jsondel(json);

	json = getjsongamepars(gm);
	sendjson(json, newusr);
	jsondel(json);

	// tell players of game someone new joined
	json= jsoncreate("newPlayer");
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
	newusr->gm = gm;

	newusr->hsize = gm->hsize;
	newusr->hfreq = gm->hfreq;
	newusr->inputs = 0;

	if(++gm->n >= gm->nmin)
		startgame(gm);

	if(DEBUG_MODE){
		printf("user %d joined game %p\n", newusr->id, (void *)gm);
		printgames();
	}
}

struct game *creategame(int nmin, int nmax) {
	struct game *gm = scalloc(1, sizeof(struct game));

	if(DEBUG_MODE)
		printf("creategame called \n");

	gm->nmin = nmin; gm->nmax = nmax;
	gm->w= GAME_WIDTH;
	gm->h= GAME_HEIGHT;
	gm->state= GS_LOBBY;
	gm->v= VELOCITY;
	gm->ts= TURN_SPEED;
	gm->nxt = headgame;
	gm->pencilgame = PENCIL_GAME;

	gm->hsize = HOLE_SIZE;
	gm->hfreq = HOLE_FREQ;
	gm->hmin = HOLE_START_MIN;
	gm->hmax = HOLE_START_MAX;

	// how big we should choose our tiles should depend only on segment length
	float seglen = gm->v * TICK_LENGTH / 1000.0;
	gm->tilew = gm->tileh = TILE_SIZE_MULTIPLIER * seglen;
	gm->htiles= ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles= ceil(1.0 * gm->h / gm->tileh);
	gm->seg = scalloc(gm->htiles * gm->vtiles, sizeof(struct seg*));

	return headgame = gm;
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
					if(DEBUG_MODE) {
						printseg(current);printf(" collided with ");printseg(seg);printf("\n");
					}
					collision = 1;
					break;
				}

			copy = smalloc(sizeof(struct seg));
			memcpy(copy, seg, sizeof(struct seg));
			copy->nxt = gm->seg[gm->htiles * j + i];
			gm->seg[gm->htiles * j + i] = copy;
		}
	}

	// we dont need the original any more: free it
	if(SEND_SEGMENTS){
		seg->nxt= gm->tosend;
		gm->tosend= seg;
	}else
		free(seg);

	return collision;
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
	
	if(usr->gm->pencilgame)
		simpencil(&usr->pencil);

	usr->inputs *= !!(tick % INPUT_CONTROL_INTERVAL);

	float oldx = usr->x, oldy = usr->y;
	usr->angle += usr->turn * usr->gm->ts * TICK_LENGTH / 1000.0;
	usr->x += cos(usr->angle) * usr->gm->v * TICK_LENGTH / 1000.0;
	usr->y += sin(usr->angle) * usr->gm->v * TICK_LENGTH / 1000.0;

	// check if usr in a hole. hole starts _AFTER_ hstart
	if(tick > usr->hstart
	 && ((tick + usr->hstart) % (usr->hsize + usr->hfreq)) < usr->hsize)
		return 0;

	struct seg *newseg = smalloc(sizeof(struct seg));
	newseg->nxt = 0;
	newseg->x1 = oldx;
	newseg->y1 = oldy;
	newseg->x2 = usr->x;
	newseg->y2 = usr->y;

	return addsegment(usr->gm, newseg);
}

// send message to group: this player died
void deadplayermsg(struct user *usr) {
	cJSON *json = jsoncreate("playerDied");
	jsonaddnum(json, "playerId", usr->id);
	sendjsontogame(json, usr->gm, 0);
	cJSON_Delete(json);
}

/* ik zag in addsegment free niet als SEND_SEGMENTS, maar ik zie je freet
 * ze hier in dat geval (Y) */
void sendsegments(struct game *gm){
	if(gm->tosend){
		cJSON *json= jsoncreate("segments");
		cJSON *ar= cJSON_CreateArray();
		struct seg *seg= gm->tosend;
		while(seg){
			struct seg *nxt= seg->nxt;
			cJSON *a= cJSON_CreateObject();
			jsonaddnum(a,"x1", seg->x1);
			jsonaddnum(a,"y1", seg->y1);
			jsonaddnum(a,"x2", seg->x2);
			jsonaddnum(a,"y2", seg->y2);
			cJSON_AddItemToArray(ar, a);
			free(seg);
			seg= nxt;
		}
		gm->tosend= 0;
		jsonaddjson(json, "segments", ar);
		sendjsontogame(json, gm, 0);
	}
}

void stopgame(struct game *gm){
	gm->state = GS_LOBBY;
}

// simulate game tick
void simgame(struct game *gm) {
	struct user *usr;

	if(gm->tick < 0) {
		gm->tick++;
		return;
	}

	for(usr = gm->usr; usr; usr = usr->nxt) {
		if(usr->alive && simuser(usr, gm->tick)) {
			if(DEBUG_MODE)
				printf("Player %d died\n", usr->id);

			usr->alive = 0;
			gm->alive--;

			deadplayermsg(usr);
		}
	}
	
	gm->tick++;
	if(SEND_SEGMENTS && gm->tick % SEND_SEGMENTS == 0)
		sendsegments(gm);
	
	if(gm->alive <= 1 && (gm->nmin > 1 || gm->alive < 1)) {
		cJSON *json= jsoncreate("endGame");
		
		if(SEND_SEGMENTS)
			sendsegments(gm);
		
		for(usr = gm->usr; usr && !usr->alive; usr = usr->nxt);
		jsonaddnum(json, "winnerId", usr ? usr->id : -1);
		sendjsontogame(json, gm, 0);
		jsondel(json);		
		printf("game %p ended. winnerId = %d\n", (void*)gm, usr ? usr->id : -1);
		remgame(gm); // voorlopig, later stopgame(gm);
	}
}


// deze functie called simgame zo goed als mogelijk elke TICK_LENGTH msec (voor elke game)
void mainloop() {
	int sleepuntil;
	struct game *gm, *nxtgm;
	struct user *usr;

	while(1) {
		for(gm = headgame; gm; gm = nxtgm){
			nxtgm= gm->nxt; // in the case that gm gets freed
			if(gm->state == GS_STARTED)
				simgame(gm);

			if(!(serverticks % SPAM_CHECK_INTERVAL))
				for(usr = gm->usr; usr; usr = usr->nxt)
					usr->chats = 0;
		}
		
		sleepuntil= ++serverticks * TICK_LENGTH;
		do{
			libwebsocket_service(ctx, max(0, sleepuntil - servermsecs()));
		}while(sleepuntil - servermsecs() > 0);
	}
}

void interpretinput(cJSON *json, struct user *usr) {
	struct userinput *input;
	//int time= jsongetint(json, "gameTime");
	int turn= jsongetint(json, "turn");
	int tick= jsongetint(json, "tick");
	int time= tick * TICK_LENGTH + TICK_LENGTH/ 2;
	int modified= 0;
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
		modified= 1;
	}
	if(usr->inputtail && tick < usr->inputtail->tick) {
		if(SHOW_WARNING)
			printf("input messages of user %d are being received out of order!\n", usr->id);
		return;
	}
	
	// put it in user queue
	if(usr->inputtail && usr->inputtail->tick == tick)
		usr->inputtail->turn = turn;
	else{
		input = smalloc(sizeof(struct userinput));
		input->tick = tick;
		input->turn = turn;
		input->nxt = 0;
		if(!usr->inputtail)
			usr->inputhead = usr->inputtail = input;
		else
			usr->inputtail = usr->inputtail->nxt = input;
	}
	
	if(SHOW_DELAY) {
		int x = (servermsecs() - usr->gm->start) - time;
		printf("delay: %d\n", x);
	}
	
	// check if user needs to adjust her gametime
	usr->delta[usr->deltaat++]= (servermsecs() - usr->gm->start) - time;
	if(usr->deltaat == DELTA_COUNT) {
		usr->deltaat= 0;
		usr->deltaon= 1;
	}
	if(usr->deltaon){
		int max= 0, i, tot= 0;
		usr->deltaon= 0;
		for(i= 0;i < DELTA_COUNT; i++){
			if(usr->delta[i] > max){
				tot += max;
				max= usr->delta[i];
			}else
				tot += usr->delta[i];
		}
		tot /= (DELTA_COUNT - 1);
		if(abs(tot) > DELTA_MAX){
			cJSON *j= jsoncreate("adjustGameTime");
			jsonaddnum(j, "forward", tot);
			sendjson(j, usr);
			jsondel(j);
			if(SHOW_WARNING)
				printf("asked user %d to adjust gametime by %d\n", usr->id, tot);
		}
	}
	
	// send to other players
	{
		cJSON *j= jsoncreate("newInput");
		jsonaddnum(j, "tick", tick);
		jsonaddnum(j, "playerId", usr->id);
		jsonaddnum(j, "turn", turn);
		if(modified)
			jsonaddnum(j, "modified", 0);
		sendjsontogame(j, usr->gm, 0);
		jsondel(j);
	}
}

/* pencil game */
void handlepencilmsg(cJSON *json, struct user *u){
	struct pencil *p = &u->pencil;
	cJSON *j = cJSON_CreateArray();
	int send = 0;
	json = jsongetjson(json, "data")->child;
	while(json){
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
		if(tick < 0){
			tick = -tick - 1;
			newstroke = 1;
		}
		if(tick < u->gm->tick)
			tick = u->gm->tick;
		if(!(tick > p->lasttick || (newstroke && tick == p->lasttick)))
			break;
		gototick(p, tick);
		if(newstroke){
			if(p->ink > MOUSEDOWN_INK - EPS){
				p->x = x;
				p->y = y;
				p->ink -= MOUSEDOWN_INK;
				p->lasttick = tick - 1; // so that a seg on tick is also possible
			}else
				break;
		}else{
			float d = getlength(p->x - x, p->y - y);
			if((d >= INK_MIN_DISTANCE - EPS || d >= p->ink - EPS) && p->ink > 0){
				int tickSolid = tick + (INK_VISIBLE + INK_SOLID) / TICK_LENGTH;
				struct pencilseg *pseg = smalloc(sizeof(struct pencilseg));
				struct seg *seg = &pseg->seg;
				cJSON *k = cJSON_CreateObject();
				if(p->ink < d){
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
				cJSON_AddItemToArray(j, k);
				send = 1;
				p->x = x;
				p->y = y;
			}else
				break;
		}
	}
	if(send){
		cJSON *k = jsoncreate("pencil");
		jsonaddjson(k, "data", j);
		sendjsontogame(k, u->gm, 0);
	}
}

struct seg *copyseg(struct seg *a){
	struct seg *b = smalloc(sizeof(struct seg));
	memcpy(b, a, sizeof(struct seg));
	return b;
}

void simpencil(struct pencil *p){
	if(p->psegtail && p->psegtail->tick == p->usr->gm->tick){
		struct pencilseg *tail = p->psegtail;
		addsegment(p->usr->gm, copyseg(&tail->seg));
		if(tail->prev){
			tail->prev->nxt = 0;
			p->psegtail = tail->prev;
		}else
			p->psegtail = p->pseghead = 0;
		free(tail);
	}
}

void resetpencil(struct pencil *p, struct user *u){
	p->ink = START_INK;
	p->psegtail = p->pseghead = 0;
	p->usr = u;
	p->tick = 0;
	p->lasttick = -1;
}

void cleanpencil(struct pencil *pen){
	struct pencilseg *p = pen->pseghead, *q;
	while(p){
		q = p->nxt;
		free(p);
		p = q;
	}
}

void gototick(struct pencil *p, int tick){
	int ticks = tick - p->tick;
	p->ink += ticks * TICK_LENGTH / 1000.0 * INK_PER_SEC;
	if(p->ink > MAX_INK)
		p->ink = MAX_INK;
}
