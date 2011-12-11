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


void sendmsg(cJSON *json, struct user *u){
	char *tmp, *buf;
	if(u->sbat==sbmax){
		if(showwarning) printf("send-buffer full.\n");
		return;
	}
	tmp= cJSON_PrintUnformatted(json); // jammer dat dit nodig is
	buf= malloc(lwsprepadding + strlen(tmp) + lwspostpadding);
	memcpy(buf + lwsprepadding, tmp, strlen(tmp));
	free(tmp);
	u->sb[u->sbat++]= buf;
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

