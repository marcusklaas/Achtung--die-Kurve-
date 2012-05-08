const int AI_NUM_DODGE[AI_STRENGTH_LEVELS] = {7, 3};
const double AI_PREDICTION_LENGTH[AI_STRENGTH_LEVELS] = {PI * 10, PI * 3};
const struct dodge AI_DODGE[AI_STRENGTH_LEVELS][AI_MAX_NUM_DODGE] = {
	{
		{PI,			3, 0}, 
		{PI,			3, 0}, 
		{2 * PI,		3, 0},
		{PI / 2,		4, 0}, 
		{PI * 3 / 2,	5, 0}, 
		{PI * 2,		6, 0}, 
		{PI * 4, 		0, 0}
	},
	{	
		{PI,			3, 0}, 
		{PI,			3, 0}, 
		{2 * PI,		3, 0}
	}
};

#define NUM_AI 3
const char AI_TYPE_NAME[NUM_AI][20] = {"hard", "easy", "old"};
const char AI_NAME[NUM_AI][20] = {"computer (hard)", "computer (easy)", "computer"};
void (*AI_INPUTMECHANISM[NUM_AI]) (struct user *usr, int tick) = {inputmechanism_mapai, inputmechanism_mapai, inputmechanism_marcusai};
const int AI_STRENGTH[NUM_AI] = {AI_HARD, AI_EASY, 0};

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
	}
	else if(gm->branchlen == gm->branchcap) {
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
		data->input = scalloc(data->inputcap, 1);
	}
	
	if(data->inputcap < tick) {
		int cap = data->inputcap;
		
		data->inputcap = max(data->inputcap * 2, tick);
		data->input = srealloc(data->input, data->inputcap);
		memset(data->input + cap, 0, data->inputcap - cap);
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
	
	for(i = 0; i < AI_NUM_DODGE[usr->strength]; i++) {
		x = AI_DODGE[usr->strength][i].length / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
		data->dodge[i].ticks = min(AI_MAX_TICKS, ceil(x));
		data->dodge[i].depth = AI_DODGE[usr->strength][i].depth;
	}
	
	x = AI_MIN_STEER / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
	data->minsteer_ticks = max(1, x);
	
	x = AI_MAX_STEER / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
	data->maxsteer_ticks = max(data->minsteer_ticks + 1, x);
	
	x = AI_PREDICTION_LENGTH[usr->strength] / max(TURN_SPEED, gm->ts) * 1000 / TICK_LENGTH;
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
			}
			else {
				data->dieseg = rd->dieseg;
				data->dietick = rd->bestpos.tick;
			}
		}
		if(data->dietick < INT_MAX) {
			data->nxtdodge = (data->nxtdodge + 1) % AI_NUM_DODGE[usr->strength];
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
			if(turn > 1 || turn < -1) {
				printf("wrong input, ai needs fix\n");
			}
			else {
				usr->aimapstate.turn = turn;
				queueinput(usr, tick, usr->aimapstate.turn);
				sendsteer(usr, tick, usr->aimapstate.turn, 0);
			}
		}
	}

	if(data->computation > 0)
		data->computation -= AI_MAX_COMPUTATION;
	
	simuserfull(&usr->aimapstate, usr, 0, 1, 0, 0);
}
