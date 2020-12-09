### release a new version
 
#### Build from git repo
- install dappnode SDK: `npm install -g @dappnode/dappnodesdk`
- Build the package: `dappnodesdk build`
  
### publish package
**TODO**

## URLs:
 - ArangoDB WebUI: http://db.brightid.public.dappnode:8529/
 - BrightID node API: http://web.brightid.public.dappnode/brightid/v5/
 - Profile service: http://web.brightid.public.dappnode/profile/ 

### Package TODOs:
- Add setup wizard to make sure user sets correct IDChain endpoint, Ethereum mainnet
  endpoint and private key for consensus packages

#### DONE:
- Use IDChain instance running on DAppNode by default
- Detect initial run and populate database accordingly
- Make sure nginx.conf is correct in web container
  -> DONE (new container "web" based on nginx image)
- Setup port mapping to access web container (API) from external
  -> NOT NEEDED - If you connect to DAppNode VPN, you can access at 
     web.brightid.public.dappnode (e.g. API v5: http://web.brightid.public.dappnode/brightid/v5/)
     External access to node API is not required unless you want to run a real public node API
- Setup network. All containers specified in docker-compose will join a common network.
    - Update service config to use correct endpoints instead of localhost
  