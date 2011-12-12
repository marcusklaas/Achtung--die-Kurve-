// safe malloc, exit(500) on error
void* smalloc(size_t size){
	void* a= malloc(size);
	if(a==0){
		fprintf(stderr, "malloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

// returns "" on error
char* getjsonstr(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(json==0){
		if(debug) fprintf(stderr, "json parse error! object '%s' not found!\n", obj);
		return "";
	}
	return json->valuestring;
}
// returns -1 on error
int getjsonint(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(json==0){
		if(debug) fprintf(stderr, "json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

cJSON* jsoncreate(char *mode){
	cJSON *json= cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}

char* jsongetpacket(cJSON *json){
	char *tmp, *buf;
	tmp= cJSON_PrintUnformatted(json); // jammer dat dit nodig is - idd, maar da's C nu 1maal
	buf= calloc(lwsprepadding + strlen(tmp) + lwspostpadding, sizeof(char));
	memcpy(buf + lwsprepadding, tmp, strlen(tmp));
	free(tmp);
	return buf;
}

void sendstr(char *buf, struct user *u){
	if(u->sbat==sbmax){
		if(showwarning) printf("send-buffer full.\n");
		return;
	}
	u->sb[u->sbat++]= buf;
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void sendjson(cJSON *json, struct user *u){
	char *buf = jsongetpacket(json);
	sendstr(buf, u);
	//free(buf); should we free?
}

/* sends a message to all in game, except for given user. to send message to
 * all, set u = 0 */
void sendjsontogame(cJSON *json, struct game *gm, struct user *u) {
	struct usern *a;
	char *buf = jsongetpacket(json);
	
	for(a= gm->usrn; a; a= a->nxt)
		if(a->usr != u)
			sendstr(buf, a->usr);

	//free(buf); should we free?
}	
