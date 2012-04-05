int readpencilmsg(struct cJSON **j, int *x, int *y, int *tick) {
	struct cJSON *json = *j;
	
	*x = json->valueint;
	if(!(json = json->next))
		return 0;
	*y = json->valueint;
	if(!(json = json->next))
		return 0;
	*tick = json->valueint;
	*j = json->next;
	return 1;
}

void queuepencilseg(struct pencil *p, int x, int y) {
	struct pencilseg *pseg;
	struct seg *seg;
	
	pseg = smalloc(sizeof(struct pencilseg));
	seg = &pseg->seg;
	seg->x1 = p->x;
	seg->y1 = p->y;
	seg->x2 = x;
	seg->y2 = y;
	seg->t = 0;
	
	pseg->tick = p->ticksolid;
	pseg->nxt = p->pseghead;
	
	if(p->pseghead)
		p->pseghead->prev = pseg;
	pseg->prev = 0;
	p->pseghead = pseg;
	if(!p->psegtail)
		p->psegtail = pseg;
		
	if(p->usr->gm->aigame) {
		checkaimapcollision(p->usr, seg, p->ticksolid, 1, 1);
		addsegmentfull(p->usr->gm, seg, 1, p->usr, p->ticksolid, 0);
	}
	
	p->ticksolid++;
}

void handlepencilmsg(cJSON *json, struct user *usr) {
	struct pencil *p = &usr->pencil;
	struct buffer buf;
	char buffer_empty = 1;
	char mousedown;
	
	json = jsongetjson(json, "data");
	if(!json)
		return;
	json = json->child;
	
	p->ticksolid = max(p->ticksolid + 1, usr->gm->tick + SERVER_DELAY / TICK_LENGTH + usr->gm->inkdelay / TICK_LENGTH);
	
	/* this will be sent to other players */
	buf.start = 0;
	appendheader(&buf, MODE_PENCIL, usr->index);
	appendtick(&buf, p->ticksolid);
	
	if((mousedown = json->valueint == -1))
		json = json->next;

	appendchar(&buf, mousedown);
	assert(!pthread_mutex_lock(&usr->gm->lock));
	
	while(json) {
		int x, y, tick;
		
		if(!readpencilmsg(&json, &x, &y, &tick))
			break;
		
		if(tick < p->tick || x < 0 || y < 0 || x > usr->gm->w || y > usr->gm->h)
			break;
			
		if(abs(usr->gm->tick + SERVER_DELAY / TICK_LENGTH - tick) > MAX_LAG_SPIKE / TICK_LENGTH) {
			warningplayer(usr, "error: tick of pencil msg not valid\n");
			break;
		}

		regenink(p, tick);

		if(mousedown) {
			if(p->ink < MOUSEDOWN_INK) {
				warningplayer(usr, "error: not enough ink for pencil down. %d required, %f left\n", MOUSEDOWN_INK, p->ink);
				break;
			}

			p->ink -= MOUSEDOWN_INK;
			p->down = 1;
			mousedown = 0;
		}
		else {
			double d = getlength(p->x - x, p->y - y);

			if(!p->down) {
				warningplayer(usr, "error: pencil move: pencil not down\n");
				break;
			}

			if(p->ink < d) {
				warningplayer(usr, "error: pencil move: not enough ink. %f required, %f left\n", d, p->ink);
				break;
			}
			
			if(d < INK_MIN_DISTANCE)
				p->down = 0;
			
			if(p->x == x && p->y == y)
				break;
			
			p->ink -= d;
			queuepencilseg(p, x, y);
		}
		
		appendpos(&buf, x, y);
		p->x = x;
		p->y = y;
		buffer_empty = 0;
	}
	
	if(!buffer_empty)
		airstr(buf.start, buf.at - buf.start, usr->gm, 0);
	
	pthread_mutex_unlock(&usr->gm->lock);
	free(buf.start);
}

void simpencil(struct pencil *p) {
	struct pencilseg *tail = p->psegtail;
	
	if(tail && tail->tick == p->usr->gm->tick) {
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
	p->ticksolid = 0;
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

void regenink(struct pencil *p, int tick) {
	int ticks = tick - p->tick;
	double inc = ticks * TICK_LENGTH / 1000.0 * p->usr->gm->inkregen;

	p->tick = tick;
	p->ink = min(p->ink + inc, p->usr->gm->inkcap);
}
