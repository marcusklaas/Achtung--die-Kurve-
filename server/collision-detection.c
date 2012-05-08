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