from websockets.server import serve
from websockets.exceptions import ConnectionClosed
from ctypes import cdll
import asyncio 
import multiprocessing
import logging
import signal
import os
import json
import time
import numpy as np
import adi
logging.basicConfig(level=logging.INFO)
operating = True
PR_SET_PDEATHSIG = 1

# Offset variables: 
yOffset = 180
drawOffset = 0
zoomOffset = 0.5
zoom = 1

# Sample rate:
sample_rate = 2.4e6 # Hz

# SDR Rx variables:
center_freq = 100e6 # Hz
fft_size = 1024
rx_gain = 0.0 # 0 -> 74.5
multiplier = 8
num_samps = fft_size * multiplier # number of samples per call to rx()

# SDR Tx variables:
carrier_freq = 100e6 # Hz
symbol_size = 500
tx_gain = 0.0 # -90 -> 0
transmitting = 0
x_int = np.random.randint(0, 40, symbol_size)
x_degrees = x_int*360/4.0 + 45 # Random angle
x_radians = x_degrees*np.pi/180 # Converts angle to radians
x_symbols = np.cos(x_radians) + 1j*np.sin(x_radians) 
samples = np.repeat(x_symbols, 16) # 16 symbols per sample
samples *= 2**14 # -1 <--> +1 -> -2^14 <--> 2^14

sdr = adi.Pluto("ip:192.168.2.1")
sdr.sample_rate = int(sample_rate)

# Config Rx
sdr.rx_lo = int(center_freq)
sdr.rx_rf_bandwidth = int(sample_rate)
sdr.rx_buffer_size = num_samps
sdr.gain_control_mode_chan0 = 'manual'
sdr.rx_hardwaregain_chan0 = rx_gain # dB, increase to increase the receive gain, but be careful not to saturate the ADC

#Config Tx
sdr.tx_lo = int(carrier_freq)
sdr.tx_rf_bandwidth = int(sample_rate)
sdr.tx_hardwaregain_chan0 = tx_gain

window = np.blackman(fft_size)

def readIQ(): # Code referenced from Claude & pysdr.org
    samples = sdr.rx()
    num_avg = len(samples) // fft_size
    psd = np.zeros(fft_size)
    # Bartlett's method (reduces noise by 1/sqrt(N), N being # of samples)
    for i in range(num_avg):
        chunk = samples[i*fft_size:(i+1)*fft_size] * window
        sp = np.fft.fftshift(np.fft.fft(chunk, fft_size))
        psd += (np.abs(sp) / (np.sum(window) /2)) ** 2
        # np.abs(sp) -> amplitude
        # np.abs(sp) ** 2 -> power spectrum
    psd /= num_avg
    psd_db = 10 * np.log10(psd + 1e-12)
    return psd_db.astype(np.float32)

def transmitIQ():
    libc = cdll.LoadLibrary('libc.so.6') # For when parent process dies
    libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
    while transmitting:
        sdr.tx(samples)

tProc = multiprocessing.Process(target=transmitIQ)

async def sender(websocket):
    try:
        while True:
            fft = readIQ()
            payload = json.dumps({
                "fft": fft.tolist(),
                "centFreq": center_freq/1e6, 
                "carrFreq": carrier_freq/1e6,
                "sampRate": sample_rate/1e6,
                "fftSize": fft_size,
                "symbSize": symbol_size,
                "bertAverage": multiplier,
                "rxGain": rx_gain,
                "txGain": tx_gain,
                "transmitting": transmitting,
                "yOffset": yOffset,
                "drawOffset": drawOffset,
                "zoomOffset": zoomOffset,
                "zoom": zoom
            })
            await websocket.send(payload)
            await asyncio.sleep(0.05)
    except ConnectionClosed:
        logging.info("Front end disconnected")
    except KeyboardInterrupt:
        logging.info("\nClosing connection")
    except Exception as e:
        logging.error(f"Error: {e}")
    finally:
        sdr.tx_destroy_buffer()
        logging.info("Connection cleaned up")
        return

async def listener(websocket):
    global yOffset
    global drawOffset
    global zoomOffset 
    global zoom
    global sample_rate
    global center_freq
    global carrier_freq
    global fft_size
    global symbol_size
    global multiplier
    global rx_gain
    global tx_gain
    global transmitting
    global window
    global tProc
    try:
        async for data in websocket:
            logging.info(f"Recieved {data}")
            jsonData = json.loads(data)
            jField = jsonData["field"]
            jNumber = jsonData["number"]
            match jField:
                case "sampRate":
                    sample_rate = jNumber * 1e6
                case "centFreq":
                    center_freq = jNumber * 1e6
                case "carrFreq":
                    carrier_freq = jNumber * 1e6
                case "fftSize":
                    fft_size = jNumber
                    window = np.blackman(fft_size)
                case "symbSize":
                    symbol_size = jNumber
                case "bertAverage":
                    multiplier = jNumber
                    sdr.rx_buffer_size = fft_size * multiplier
                case "rxGain":
                    rx_gain = jNumber 
                case "txGain":
                    tx_gain = jNumber
                case "transmitting":
                    sdr.tx_destroy_buffer()
                    transmitting = 1 if not transmitting else 0
                    if transmitting:
                        tProc = multiprocessing.Process(target=transmitIQ)
                        tProc.start()
                    else:
                        if tProc: tProc.terminate()
                        tProc = None
                case "yOffset":
                    yOffset = jNumber
                case "drawOffset":
                    drawOffset = jNumber
                case "zoomOffset":
                    zoomOffset = jNumber
                case "zoom":
                    zoom = jNumber
                case "_":
                    pass
            # Reconfig SDR
    except ConnectionClosed:
        return

async def rateLimit(): # User changable fields that directly configure the SDR need to be rate limited
    global operating
    global samples 
    global tProc
    currentsymbol_size = symbol_size
    try:
        while operating:
            #logging.info(f"sdr: {sdr.rx_hardwaregain_chan0}, sr: {rx_gain}, o:{abs(sdr.rx_hardwaregain_chan0-rx_gain)>0.1}")
            #logging.info(f"sdr cent: {sdr.rx_lo/1e6}, cent: {center_freq/1e6}, o:{abs(sdr.rx_lo/1e6-center_freq/1e6)>0.1}")
            #logging.info(f"sdr carr: {sdr.tx_lo/1e6}, carr: {carrier_freq/1e6}, o:{abs(sdr.tx_lo/1e6-carrier_freq/1e6)>0.1}")
            if abs(sdr.sample_rate/1e6-sample_rate/1e6)>0.1: # If a big enough change was made
                logging.info("Changing samprate")
                sdr.sample_rate=sample_rate
                sdr.sample_rate = int(sample_rate)
                sdr.rx_rf_bandwidth = int(sample_rate)
            if abs(sdr.rx_lo/1e6-center_freq/1e6)>0.1: 
                logging.info("Changing centfreq")
                sdr.rx_lo=int(center_freq)
            if abs(sdr.tx_lo/1e6-carrier_freq/1e6)>0.1:
                logging.info("Changing carrfreq")
                sdr.tx_lo=int(carrier_freq)
            if sdr.rx_buffer_size!=fft_size*multiplier:  
                logging.info("Changing fftsize")
                sdr.rx_buffer_size = fft_size * multiplier
            if abs(sdr.rx_hardwaregain_chan0-rx_gain)>0.1:
                logging.info("Changing rgain")
                sdr.rx_hardwaregain_chan0 = rx_gain
            if abs(sdr.tx_hardwaregain_chan0-tx_gain)>0.1:
                logging.info("Changing tgain")
                sdr.tx_hardwaregain_chan0 = tx_gain
            if currentsymbol_size!=symbol_size:
                currentsymbol_size = symbol_size
                x_int = np.random.randint(0, 40, currentsymbol_size)
                x_degrees = x_int*360/4.0 + 45 # Random angle
                x_radians = x_degrees*np.pi/180 # Converts angle to radians
                x_symbols = np.cos(x_radians) + 1j*np.sin(x_radians) # -1 <--> +1 -> -2^14 <--> 2^14
                samples = np.repeat(x_symbols, 16) # 16 symbols per sample
                samples *= 2**14
                if transmitting:
                    if tProc!=None: 
                        tProc.terminate() 
                        tProc = multiprocessing.Process(target=transmitIQ)
                        tProc.start()

            await asyncio.sleep(2)
    except KeyboardInterrupt:
        operating = False
        logging.info("\nClosing connection")
        return

async def handle(websocket):
    logging.info("Front end connected")
    await asyncio.gather(
        sender(websocket),
        listener(websocket),
        rateLimit()
        )

async def main():
    async with serve(handle, "0.0.0.0", 5829):
        logging.info("Websocket created: ws://localhost:5829")
        await asyncio.Future()
                             
if __name__ == "__main__":
    asyncio.run(main())   
