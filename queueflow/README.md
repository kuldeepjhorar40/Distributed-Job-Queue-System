cd backend
npm install
1.terminal 1:-
    wsl -d Ubuntu
    redis-server
2.terminal 2:- 
    mongod --dbpath C:\data\db
3.terminal 3:-
    node src/workers/worker.js
4.terminal 4:-
    npx nodemon src/server.js
5.gitbash command:-
    $ curl -X POST https://localhost:3000/job \
    > -H "Content-Type: application/json" \
    > -d '{"task":"email","payload":{"to":"test@gmail.com"}}'
