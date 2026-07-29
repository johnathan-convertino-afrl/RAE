// Written by Michael Conaway & Elizabeth Estaban
// Claude code referenced for canvas drawing functions
import { useState, useRef, useEffect, useCallback } from "react";
import Control from "./components/controls";
//const backSocket = "ws://localhost:5829";  // Debug
//const backSocket = "ws://192.168.0.38:5829";  // Production (dorm)
const backSocket = "ws://172.20.10.5:5829";  // Production
const verticalLineAmt = 8; // Made this a varible IN CASE it becomes customizable
const maxRows = 10;
function dbToColor(db, minDb = -100, maxDb = 50){
	const norm = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
	if(norm < 0.25) return `hsl(240,80%,${10 + norm * 4 * 30}%)`;
	if(norm < 0.5) return `hsl(${320 - (norm - 0.25) * 4 * 160},80%,40%)`;
	if(norm < 0.75) return `hsl(${240 - (norm - 0.5) * 4 * 120},90%,45%)`;
	return `hsl(${120 - (norm - 0.75) * 4 * 120},100%,${50 + (norm - 0.75) * 20}%)`
}

function ReceiveMenu(props){
	return(
	  <div id="scroll">
	    <div id="control-holder">
	      <p id="controls">Reception Controls</p>
	    </div> 
	    <Control labelName="Sample Rate (MHz)" field="sampRate" init="2.4" min="1" max="20" step="0.2" changed={props.payloadFunction} value={props.sr}/>
	    <Control labelName="Center Frequency (MHz)" field="centFreq" min="100" max="6000" step="100" changed={props.payloadFunction} value={props.cf}/>
	    <Control labelName="Amount of Samples" field="fftSize" min="100" max="8000" step="100" changed={props.payloadFunction} value={props.fs}/>
	    <Control labelName="Receiver Gain (dB)" field="rxGain" min="0" max="60" changed={props.payloadFunction} value={props.g}/>
	    <Control labelName="Y Offset" field="yOffset" min="0" max="400" step="10" changed={props.payloadFunction} value={props.yo}/>
	    <Control labelName="Zoom" field="zoom" min="1" max="100" step="1" changed={props.payloadFunction} value={props.z}/>
	    <div id="rx-buttons">
	      <button id="buttons" onClick={props.buttonFunction}> Trasmission Controls </button>
	    </div>
	   </div>
	);
}

function TransmitMenu(props){
	console.log(`${props.tr}`)
	return(
	  <div id="scroll">
	    <div id="control-holder">
	      <p id="controls">Transmission Controls</p>
	    </div> 
	    <Control labelName="Sample Rate (MHz)" field="sampRate" init="2.4" min="1" max="20" step="0.2" changed={props.payloadFunction} value={props.sr}/>
	    <Control labelName="Carrier Frequency (MHz)" field="carrFreq" min="100" max="6000" step="100" changed={props.payloadFunction} value={props.cf}/>
	    <Control labelName="Amount of Symbols" field="symbSize" min="0" max="1000" step="10" changed={props.payloadFunction} value={props.ss}/>
	    <Control labelName="Transmit Gain (dB)" field="txGain" min="-80.0" max="0.0" changed={props.payloadFunction} value={props.g}/>
	    <Control labelName="Y Offset" field="yOffset" min="0" max="400" step="10" changed={props.payloadFunction} value={props.yo}/>
	    <Control labelName="Zoom" field="zoom" min="1" max="100" step="1" changed={props.payloadFunction} value={props.z}/>
	    <div id="tx-buttons">

	      <button id="buttons" onClick={props.button1Function}> {props.tr ? "End Transmission" : "Begin Transmission"} </button>
	      <button id="buttons" onClick={props.button2Function}> Reception Controls </button>
	    </div>
	  </div>
	);
}

export default function SDRDisp() {
	// States re-render the page everytime it's changed
	const [sockUrl, setSock] = useState(backSocket);
	const [conn, setConn] = useState("disconnected");
	const [yOffset, setYOffset] = useState(180);
	const [drawOffset, setDrawOffset] = useState(0);
	const [zoomOffset, setZoomOffset] = useState(0.5);
	const [zoom, setZoom] = useState(1);
	const [bertAvg, setBertAvg] = useState(8); // Depricated
	// Socket fields
	const [sampRate, setSampRate] = useState(2.4);
	// Recieving 
	const [fftSize, setFFTSize] = useState(1024);
	const [centFreq, setCentFreq] = useState(100);
	const [rxGain, setRXGain] = useState(-30.0);
	// Transmitting 
	const [symbSize, setSymbSize] = useState(1000);
	const [carrFreq, setCarrFreq] = useState(100);
	const [txGain, setTXGain] = useState(-50.0);
	const [transmitting, setTransmitting] = useState(0);
	// Menu number
	const [menu, setMenu] = useState(0);
	// References DON'T re-render the page update. Use these if a variable needs to read from a constantly updating state
	const yOffsetRef = useRef(180);
	const drawOffsetRef = useRef(0);
	const zoomOffsetRef = useRef(0.5);
	const zoomRef = useRef(1);
	const bertAvgRef = useRef(8);
	const sampRateRef = useRef(2.4);
	const fftSizeRef = useRef(1024);
	const centFreqRef = useRef(100);
	const rxGainRef = useRef(-30.0);
	const symbSizeRef = useRef(1000);
	const carrFreqRef = useRef(100);
	const txGainRef = useRef(-50.0);
	const transmittingRef = useRef(0);
	const currentAnim = useRef(null);
	const backendSock = useRef(null);
	const spectrumCanv = useRef(null);
	const waterfallCanv = useRef(null);
	const spectrumData = useRef(new Float32Array(fftSize).fill(-100));
	const rowRef = useRef([])
	const frameCount = useRef(0);
	// Field map
	const fieldMap = { // Maps JSON field data to corresponding react states and set functions
		"sampRate": [sampRateRef, setSampRate],
		"centFreq": [centFreqRef, setCentFreq],
		"carrFreq": [carrFreqRef, setCarrFreq],
		"fftSize": [fftSizeRef, setFFTSize],
		"symbSize": [symbSizeRef, setSymbSize],
		"bertAverage": [bertAvgRef, setBertAvg], // Depricated
		"rxGain": [rxGainRef, setRXGain],
		"txGain": [txGainRef, setTXGain],
		"transmitting": [transmittingRef, setTransmitting],
		"yOffset": [yOffsetRef, setYOffset], 
		"drawOffset": [drawOffsetRef, setDrawOffset], 
		"zoomOffset": [zoomOffsetRef, setZoomOffset],
		"zoom": [zoomRef, setZoom]
	};
	const setState = (state, value) => {
		if(fieldMap[state]){
			fieldMap[state][1](value);
			fieldMap[state][0].current = value;
		}
	}
	const spectDraw = useCallback(() => { // Generated by Claude, heavily edited for implementation
		const canv = spectrumCanv.current;
		if (!canv) return;
		const context = canv.getContext("2d");
		const width = canv.width;
		const height = canv.height;
		const iQ = spectrumData.current;
		context.fillStyle = "#080c10";
		context.fillRect(0,0,width,height);
		// Drawing grid -v
		context.strokeStyle = "rgba(255,255,255,0.5)";
		context.lineWidth = 0.5;
		context.font = "10px monospace";
		context.fillStyle = "rgba(255,255,255,0.4)";
		// Horizontal lines w/ y axis labels
		for(let db = -200; db <= 200; db += 10){
			const y = height+yOffset - ((db + (100/zoomOffset))/(80/zoomOffset)) * height;
			context.beginPath();
			context.moveTo(0,y);
			context.stroke();
			context.fillText(`${db} dB`, 4, y - 3);
		}
		let dist = ((fftSize-drawOffset)-drawOffset)/128 // 128 -> 8 Lines, 256 -> 4 Lines
		// Vertical lines
		for(let i = 0; i <= dist/2; i++){
			const left = (dist/2)-i;
			const right = (dist/2)+i;
			let x = ((left/dist) * width);
			context.beginPath();
			context.moveTo(x,0);
			context.lineTo(x,height);
			context.stroke();
			x = ((right/dist) * width);
			context.beginPath();
			context.moveTo(x,0);
			context.lineTo(x,height);
			context.stroke();
		}
		// X axis labels
		if(centFreq && sampRate){
			context.fillStyle = "rgba(255,255,255,0.5)";
			for(let i = 0; i <= 4; i++){
				const freqText = (centFreq - sampRate/2 + (i/4) * sampRate); // i = 1 -> 100
				//console.log(`CF: ${centFreq}, SR: ${sampRate}, FT: ${freqText}}`)
				const x = ((i*((drawOffset+128)/512)) * width - drawOffset*2);
				context.fillText(`${freqText.toFixed(2)} MHz`, x + 2, height-6);
			}
		}
		// Area under curve
		const incr = (width/(fftSize-drawOffset*2));
		const gradient = context.createLinearGradient(0,0,0,height);
		gradient.addColorStop(0,"rgba(14,68,176,0.25)");
		gradient.addColorStop(0,"rgba(14,68,176,0.02)");
		context.fillStyle = gradient;
		context.beginPath();
		context.moveTo(0,height);
		for(let i = 0; i < fftSize; i++){
			const y = height+yOffset - ((iQ[i]) + (100/zoomOffset)) / (80/zoomOffset) * height;
			context.lineTo(i * incr, Math.max(0, Math.min(height, y)));
		}
		context.lineTo(width, height);
		context.closePath();
		context.fill();
		// Spectrum
		context.lineWidth = 1;
		context.strokeStyle = "#b5c7eb";
		context.shadowBlur = 5;
		context.shadowColor = "#628de3"
		context.beginPath();
		for (let i = drawOffset; i < fftSize-drawOffset; i++){
			const x = ((i-drawOffset)*incr)+2;
			const y = height+yOffset - ((iQ[i] + (100/zoomOffset)) / (80/zoomOffset)) * height;
			i === 0 ? context.moveTo(x,y) : context.lineTo(x,y);
		}
		context.stroke();
		context.shadowBlur = 0;
	}, [yOffset, zoomOffset, drawOffset, bertAvg, rxGain, fftSize, centFreq, sampRate]);
	const waterfallDraw = useCallback(() => {
		const canv = waterfallCanv.current;
		if(!canv) return;
		const context = canv.getContext("2d");
		const width = canv.width;
		const height = canv.height;
		const rows = rowRef.current;
		context.fillStyle = "#000";
		context.fillRect(0,0,width, height);
		const rowH = Math.max(1, height / maxRows);
		const start = Math.max(0, rows.length - maxRows);
		//let dist = ((sampCount-drawOffset)-drawOffset)/128 // 128 -> 8 Lines, 256 -> 4 Lines
		const dist = width/fftSize;
		for(let i = start; i < rows.length; i++){
			const row = rows[i];
			const y = (rows.length - 1 - i) * rowH; // <- Grows up / height  (rows.length - i) * rowH;
			for (let j = 0; j < row.length; j++){
				context.fillStyle = dbToColor(row[j]);
				context.fillRect(Math.floor(j * dist), y, Math.ceil(dist)+1, Math.ceil(rowH)+1);
			}
		}
	}, [yOffset, zoomOffset, drawOffset, bertAvg, rxGain, fftSize]);
	// Render loop
	const renderL = useCallback(() => {
		spectDraw();
		waterfallDraw();
		//console.log(`Yoffset: ${yOffset}, Zoomoffset: ${zoomOffset}`);
		currentAnim.current = requestAnimationFrame(renderL);
	}, [spectDraw, waterfallDraw]);
	// Canvas resize every draw loop
	useEffect(() => {
		const resize = () => {
			const w = spectrumCanv.current?.parentElement?.offsetWidth ?? 700;
			if(spectrumCanv.current) {
				spectrumCanv.current.width = w; 
				spectrumCanv.current.height = 280;
			}
			if(waterfallCanv.current){
				waterfallCanv.current.width = w;
				waterfallCanv.current.height = 180;
			}
		};
		resize();
		window.addEventListener("resize",resize);
		currentAnim.current = requestAnimationFrame(renderL);
		return () => {
			window.removeEventListener("resize",resize);
			cancelAnimationFrame(currentAnim.current);
		};
	}, [renderL]);
	const connect = useCallback(() => {
		if(backendSock.current){
			backendSock.current.close();
			backendSock.current = null;
		}
		setConn("connecting");
		const sock = new WebSocket(backSocket);
		sock.binaryType = "arraybuffer";
		backendSock.current = sock;
		sock.onopen = () =>  {setConn("connected")}//; setPlayStatus("playing");}
		sock.onmessage = (evt) => {
			try{
				const json = JSON.parse(evt.data);
				if(!Array.isArray(json.fft)) return;
				spectrumData.current = new Float32Array(json.fft);
				if(frameCount.current%10==0){
					rowRef.current.push(spectrumData.current.slice());
				}
				if(rowRef.current.length > maxRows){
					rowRef.current = rowRef.current.slice(-maxRows);
				}
				for(const [index,fieldVal] of Object.entries(fieldMap)) {
					if (fieldVal[0].current != json[index]){ // If a value is changed on the backend, update on the front end
						if(index=="fftSize"){
							rowRef.current.length = 0;
						}
						setState(index,json[index]);
					}
				}
				frameCount.current++;	
			} catch {}
		}
		sock.onerror = () => {setConn("error"); alert("Could not connect to SDR! Make sure that the device is plugged in!")};
		sock.onclose = () => {
			setConn("disconnected");
			backendSock.current = null;
			
		}
	}, [backSocket]);
	const disconnect = useCallback(() => {
		backendSock.current?.close();
		backendSock.current = null;
		setConn("disconnected");
	}, []);
	function sendPayload(evt){
		const param = evt.target.id;
		const data = Number(evt.target.value);
		const changingFields = {};
		switch (param){
			case "sampRate":
				if(data<1){data=1;} else if(data>20){data=20;}
				break;
			case "centFreq":
				if(data<100){data=100;} else if(data>6000){data=6000;}
				break;
			case "carrFreq":
				if(data<70){data=70;} else if(data>6000){data=6000;}
				break;
			case "fftSize":
				if(data<100){data=100;} else if(data>8000){data=8000;}
				changingFields["drawOffset"]=0;
				changingFields["zoom"]=1;
				changingFields["zoomOffset"]=0.5;
				break;
			case "symbSize":
				if(data<0){data=0;} else if(data>1000){data=1000;}
				break;
			case "bertAverage": // Depricated
				if(data<2){data=2;} else if(data>8){data=8;}
				break;
			case "rxGain":
				if(data<0){data=0;} else if(data>60){data=60;}
				break;
			case "txGain":
				if(data<-90.0){data=-90.0;} else if(data>0.0){data=0.0;}
				break;
			case "yOffset":
				if(data<0){data=0;} else if(data>400){data=400;}
				break;
			case "drawOffset": // Depricated
				if(data<0){data=0;} else if(data>(fftSize/2)-10){data=(fftSize/2)-10;}
				break;	
			case "zoomOffset": // Depricated
				if(data<0.5){data=0.5;} else if(data>2){data=2;}
				changingFields["yOffset"]=(-187.78*data+650)/2;
				break;
			case "zoom":
				if(data<1){data=1;} else if(data>100){data=100;}
				const xdraw = Math.trunc(((fftSize/2)-10)*(data/100));
				const ydraw = Math.max(Math.round((2*(data/100))*10)/10,0.5);
				changingFields["drawOffset"]=xdraw;
				changingFields["zoomOffset"]=ydraw;
				break;
			default:
				return
		}
		changingFields[param]=data;
		for(const [index,fieldVal] of Object.entries(changingFields)) {
			setState(index,fieldVal); // Update states
			const payload = {
				field: index,
				number: fieldVal,
			};
			backendSock.current?.send(JSON.stringify(payload)); // Send payload
		}
			
	}
	const startTransmittion = () => {
		//const no = transmitting ? 0 : 1
		//setTransmitting(no);
		backendSock.current?.send(JSON.stringify({field: "transmitting", number: -1}));
	}
	return (
	<div style={{ fontFamily: "monospace"  }}>
		<div id="top">
			<p id="title" >
				MistyBlue SDR Analyser
			</p>
		</div>
		<div>
		  <div id="stack">
		    <canvas id="container" ref={spectrumCanv} style={{ width: "100%" }} /> 
		    <canvas id="container" ref={waterfallCanv} style={{ width: "100%" }} /> 
	   	    <button id="buttons" onClick={conn==="connected" ? disconnect : connect}>
			{conn === "connected" ? "Disconnect" : "Connect"}
		    </button>
		  </div>
		  {menu == 0 ?
		  <ReceiveMenu payloadFunction={sendPayload} buttonFunction={() => {setMenu(1);}} sr={sampRate} cf={centFreq} fs={fftSize} g={rxGain} yo={yOffset} z={zoom} />
		  :
		  <TransmitMenu payloadFunction={sendPayload} button1Function={startTransmittion} button2Function={() => {setMenu(0);}} sr={sampRate} cf={carrFreq} ss={symbSize} g={txGain} yo={yOffset} z={zoom} tr={transmitting} />
		  }
		</div>
	</div>
	);
}

//export default SDRDisp;
