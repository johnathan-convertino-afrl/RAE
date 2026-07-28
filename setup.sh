#!/bin/bash
set -e
cd /home/pi/SDR/
clean(){
	echo "Killing processes"
	kill -9 "$PYTHONPROC" 2>/dev/null
       	kill -9 "$REACTPROC" 2>/dev/null
}
trap clean INT TERM EXIT
/home/pi/SDR/flaskEnv//bin/python3 /home/pi/SDR/web/websocket.py &
PYTHONPROC=$!
cd /home/pi/SDR/web/front
npm run dev -- --host &
REACTPROC=$!
firefox --kiosk http://localhost:5173
wait 
