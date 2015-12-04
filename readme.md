#Stampede - Bitcoin trading bot
Node.js bitcoin trading bot experiment. Runnable from any low -> high spec machine or instance. Best put behind nginx or other http proxy for front end.

##Supported
Bitstamp and Btcchina exchanges are supported.

##Configuration and deployment
1. Install nodejs (v0.10+)
2. Install redis (v2.4+)
3. Install and setup nginx if you are going to put it in front of nodejs
4. Create config file. The app can be configured by making a copy of the /plugins/config_template.js file to /plugins/config.js using your information and api keys.

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