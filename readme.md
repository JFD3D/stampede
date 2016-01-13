#Stampede - Bitcoin trading bot
Node.js bitcoin trading bot experiment. Runnable from any low spec machine or instance. Best put behind nginx or other http proxy for front end.

##Supported
Bitstamp exchange is supported.

##Configuration and deployment
1. Install nodejs (v4.0+)
2. Install redis (v2.4+)
3. Install and setup nginx if you are going to put it in front of nodejs
4. Create config file. The app can be configured by making a copy of the /plugins/config_template.json file to /plugins/config.js using your information and api keys.

##Simulator
Stampede allows backtesting and testing on generated data sets. 

###Backtesting data
You can load past data via '/data_loader' path. You can name the data set and select the number of days for cutoff.
Obtain the data from [bitcoin charts](http://api.bitcoincharts.com/v1/csv/bitstampUSD.csv.gz), or another source in CSV format of: time[unix_time_stamp],price[float].

###Generated data
You can generate new (30 days long) datasets via '/simulator' path, which will base them on short, mid, long term vectors.

###Simulations
You can run one-off or live simulations via '/simulator' path. First load the data set and then start simulation.

###Simulation series

This lets you run the simulations in parallel for combinations of trading and strategy configurations.

1. Generate or load some data sets via '/simulator' or '/data_loader'
2. Mark the data sets to be included in series via '/simulator'
3. Then copy and adjust series_config_template.json into a series_config.json file
4. You can run the series simulation via: '/simulator/series'

##Maintainers
Peter Berezny - [Github](https://github.com/pejrak)
Matthew Perkins - [Github](https://github.com/mattarse)

You are welcome to fork and use the repository. This started as a fun project by non expert developers, we welcome suggestions for improvement and pull requests. Actually, we welcome any attention to be honest.

##License
The MIT License (MIT)

Copyright (c) 2014 Peter Berezny

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.