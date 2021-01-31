FROM gcc:latest
WORKDIR /usr/src/achtung
COPY . .
RUN ./configure && libtoolize && aclocal && make clean && make && make install
WORKDIR /usr/src/achtung/server
CMD ["./kurveserver", "-p", "80"]